// Re-encodes the hero background loop: rescales, drops the audio track, and
// targets a bitrate. Uses AVFoundation, so it needs nothing installed —
// macOS ships everything required.
//
//   swift tools/encode-hero.swift <input> <output> <width> <height> <kbps>
//
// The source footage is soft and blurred, so it survives a far lower bitrate
// than the camera original was written at. The audio track is dropped
// outright: the page mutes the video, so those bytes were never played.
//
// Regenerate both variants (run from the website/ folder):
//   swift tools/encode-hero.swift assets/video/hero-source.mp4 \
//         assets/video/hero.mp4        1920 1080 2000
//   swift tools/encode-hero.swift assets/video/hero-source.mp4 \
//         assets/video/hero-mobile.mp4 1280  720  850

import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count == 6,
      let width = Int(args[3]), let height = Int(args[4]), let kbps = Int(args[5]) else {
    FileHandle.standardError.write(
        "usage: encode-hero.swift <input> <output> <width> <height> <kbps>\n".data(using: .utf8)!)
    exit(2)
}

let inputURL = URL(fileURLWithPath: args[1])
let outputURL = URL(fileURLWithPath: args[2])

let asset = AVURLAsset(url: inputURL)
guard let sourceTrack = asset.tracks(withMediaType: .video).first else {
    FileHandle.standardError.write("no video track in \(args[1])\n".data(using: .utf8)!)
    exit(1)
}

let naturalSize = sourceTrack.naturalSize.applying(sourceTrack.preferredTransform)
let sourceWidth = abs(naturalSize.width)
let sourceHeight = abs(naturalSize.height)
let fps = sourceTrack.nominalFrameRate > 0 ? sourceTrack.nominalFrameRate : 30

try? FileManager.default.removeItem(at: outputURL)

// --- Reader: scale frames down through a video composition ------------------

let videoComposition = AVMutableVideoComposition()
videoComposition.renderSize = CGSize(width: width, height: height)
videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(fps.rounded()))

let instruction = AVMutableVideoCompositionInstruction()
instruction.timeRange = CMTimeRange(start: .zero, duration: asset.duration)

let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: sourceTrack)
let scale = CGAffineTransform(scaleX: CGFloat(width) / sourceWidth,
                              y: CGFloat(height) / sourceHeight)
layer.setTransform(sourceTrack.preferredTransform.concatenating(scale), at: .zero)
instruction.layerInstructions = [layer]
videoComposition.instructions = [instruction]

let reader = try AVAssetReader(asset: asset)
let readerOutput = AVAssetReaderVideoCompositionOutput(
    videoTracks: [sourceTrack],
    videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
readerOutput.videoComposition = videoComposition
reader.add(readerOutput)

// --- Writer: video only, no audio input is ever added -----------------------

let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true   // moov atom first, so it streams

let writerInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: kbps * 1000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoAllowFrameReorderingKey: true,
        AVVideoMaxKeyFrameIntervalKey: Int(fps.rounded()) * 2,
    ],
])
writerInput.expectsMediaDataInRealTime = false
writer.add(writerInput)

guard writer.startWriting() else {
    FileHandle.standardError.write("writer failed: \(writer.error?.localizedDescription ?? "?")\n"
        .data(using: .utf8)!)
    exit(1)
}
writer.startSession(atSourceTime: .zero)
reader.startReading()

let done = DispatchSemaphore(value: 0)
var frames = 0

writerInput.requestMediaDataWhenReady(on: DispatchQueue(label: "encode")) {
    while writerInput.isReadyForMoreMediaData {
        guard let buffer = readerOutput.copyNextSampleBuffer() else {
            writerInput.markAsFinished()
            writer.finishWriting { done.signal() }
            return
        }
        writerInput.append(buffer)
        frames += 1
    }
}

done.wait()

if writer.status != .completed {
    FileHandle.standardError.write("export failed: \(writer.error?.localizedDescription ?? "?")\n"
        .data(using: .utf8)!)
    exit(1)
}

let attributes = try? FileManager.default.attributesOfItem(atPath: outputURL.path)
let bytes = (attributes?[.size] as? Int) ?? 0
print(String(format: "%@  %dx%d  %d frames  %.2f MB",
             outputURL.lastPathComponent, width, height, frames,
             Double(bytes) / 1_048_576))
