// Offset crop + JPEG export. sips only crops centre-anchored, and the framing
// this needs is off-centre vertically, so the crop is done through CoreGraphics
// instead.
//
//   swift tools/crop-image.swift <in> <out> <x> <y> <w> <h> <quality>
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let a = CommandLine.arguments
guard a.count == 8,
      let x = Int(a[3]), let y = Int(a[4]),
      let w = Int(a[5]), let h = Int(a[6]), let q = Double(a[7]) else {
    FileHandle.standardError.write("usage: crop-image <in> <out> <x> <y> <w> <h> <quality>\n".data(using: .utf8)!)
    exit(1)
}
let inURL = URL(fileURLWithPath: a[1]), outURL = URL(fileURLWithPath: a[2])

guard let src = CGImageSourceCreateWithURL(inURL as CFURL, nil),
      let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    FileHandle.standardError.write("cannot read \(a[1])\n".data(using: .utf8)!); exit(1)
}
// CGImage.cropping(to:) takes pixel coords with the origin at the top-left.
guard let cropped = img.cropping(to: CGRect(x: x, y: y, width: w, height: h)) else {
    FileHandle.standardError.write("crop rect out of bounds\n".data(using: .utf8)!); exit(1)
}
guard let dest = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
    FileHandle.standardError.write("cannot write \(a[2])\n".data(using: .utf8)!); exit(1)
}
CGImageDestinationAddImage(dest, cropped, [kCGImageDestinationLossyCompressionQuality: q] as CFDictionary)
guard CGImageDestinationFinalize(dest) else {
    FileHandle.standardError.write("encode failed\n".data(using: .utf8)!); exit(1)
}
print("wrote \(a[2]) — \(cropped.width)x\(cropped.height)")
