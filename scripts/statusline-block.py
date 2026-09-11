# The block scripts/statusline-patch.ts merges into ~/.claude/hooks/statusline.py (P1-T6).
#
# It lives here, as real Python, so it is reviewed, diffed and round-trip tested like any other
# source file rather than existing only as a string inside a patcher. The two marker pairs are
# the contract with StatuslinePatcher: the `flightdeck` region is inserted above `def main():`,
# the `flightdeck call` region is inserted after the `cache_flush()` at the end of main, and
# Disconnect (SEC-OPS-2) removes exactly the marked regions. Nothing outside the markers is ever
# touched — SEC-ING-3 requires the change to be additive and the render to stay byte-identical.
#
# Python 3.8+, standard library only. The three imports below are already at the top of
# statusline.py, which is why they sit outside the markers: this file has them so it parses and
# so a smoke test can import it, but the patch never adds an import.
import json
import os
import sys


# --- flightdeck begin (P1-T6) ---
# Posts the payload Claude Code already computed to flightdeck-core, then gets out of the way.
# SECURITY.md SEC-ING-3: read the token file, POST with a 150 ms timeout, swallow every
# exception, never write to stdout.
#
# HTTP is hand-built over a raw socket rather than through http.client or urllib.request
# because on this machine importing either costs ~70 ms against statusline.py's own import set
# while `socket` costs 11 ms — and this script runs on every render (RESEARCH.md F.3.1). The
# import is deferred until a token exists, so a machine with Flightdeck disconnected pays one
# failed open() and nothing else.
#
# The connect timeout is deliberately much shorter than the 150 ms read timeout: a Python
# connect to a closed loopback port on this machine is *not* refused, it is dropped, so it
# costs the whole connect timeout (RESEARCH.md F.3.3). A live core answers the connect in
# about 1 ms, so 25 ms is 25x headroom and caps the cost of a dead core at ~25 ms.
FD_HOST = "127.0.0.1"
FD_PORT = 4950
FD_PATH = "/statusline"
FD_CONNECT_TIMEOUT_S = 0.025
FD_TIMEOUT_S = 0.15
FD_REQUEST = (
    "POST %s HTTP/1.1\r\n"
    "Host: %s:%d\r\n"
    "Authorization: Bearer %s\r\n"
    "Content-Type: application/json\r\n"
    "Content-Length: %d\r\n"
    "Connection: close\r\n"
    "\r\n"
)


def fd_token():
    """The per-boot bearer token (SEC-HTTP-3), or None when core is not running."""
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        return None
    try:
        with open(os.path.join(local, "flightdeck", "token"), "r", encoding="utf-8") as handle:
            return handle.read(128).strip() or None
    except Exception:
        return None


def fd_post(payload):
    """Send one status-line payload to core. Never raises; the render is already written."""
    token = fd_token()
    if not token:
        return
    try:
        import socket

        body = json.dumps(payload).encode("utf-8")
        head = (FD_REQUEST % (FD_PATH, FD_HOST, FD_PORT, token, len(body))).encode("ascii")
        conn = socket.create_connection((FD_HOST, FD_PORT), FD_CONNECT_TIMEOUT_S)
        try:
            conn.settimeout(FD_TIMEOUT_S)
            conn.sendall(head + body)
            # Waiting for the ack is what the 150 ms timeout actually bounds; core acks in
            # under 5 ms (SEC-ING-2), so on a healthy machine this is one loopback round trip.
            conn.recv(64)
        finally:
            conn.close()
    except Exception:
        pass


# --- flightdeck end ---


def _call_site(data):
    """Not patched in. Holds the second region at the indentation main() needs."""
    # --- flightdeck call begin (P1-T6) ---
    # The status line is already on stdout; flush it so nothing below can delay the render.
    sys.stdout.flush()
    fd_post(data)
    # --- flightdeck call end ---
