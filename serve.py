#!/usr/bin/env python3
"""Tiny static file server for local preview of the AYRA landing page.

    python3 website/serve.py            # http://localhost:4321
    python3 website/serve.py 8080       # pick a port

Not needed to view the site — index.html opens fine by double-click — but a
real server avoids file:// quirks with fonts and lets you test on a phone
over the local network.
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4321

os.chdir(ROOT)
# extensions_map lives on the class, not on the partial — setting it on the
# partial raises AttributeError and the server never starts.
http.server.SimpleHTTPRequestHandler.extensions_map.setdefault(".svg", "image/svg+xml")


class Handler(http.server.SimpleHTTPRequestHandler):
    """Preview server: never let the browser cache.

    The default handler sends Last-Modified and no Cache-Control, so Chrome
    heuristically caches css/js and keeps serving the old file after an edit —
    the page reloads and nothing changes, which reads as "the fix didn't work"
    rather than "you are looking at yesterday's stylesheet".
    """

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


handler = functools.partial(Handler, directory=ROOT)

with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
    print(f"AYRA site serving {ROOT} at http://localhost:{PORT}")
    httpd.serve_forever()
