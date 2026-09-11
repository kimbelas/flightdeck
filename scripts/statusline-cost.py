# P0-T5 — times fd_post() in-process, which is the number the block's design turns on.
#
#   python scripts/statusline-cost.py <block.py> <payload.json> <reps>   ->  JSON on stdout
#
# Timing a whole `python statusline.py` spawn cannot answer this: a spawn on this machine is
# 160-330 ms depending on what else is running, and the POST costs 1-25 ms, so the noise is an
# order of magnitude larger than the signal. Calling fd_post directly, in one process, measures
# exactly the code the patch inserts and nothing else. The byte-identity of the render is proved
# separately, by comparison, where timing precision does not matter.
#
# The first call is reported apart from the rest because it pays the deferred `import socket`,
# and a statusline process serves exactly one render — so the *first* number is the one a render
# actually pays, and the rest only describe the network cost.
#
# statusline.py's own imports are repeated below so that deferred `import socket` costs the same
# here as it does in situ: much of socket's cost is shared machinery, and against a bare
# interpreter it looks about four times more expensive than it really is.
import hashlib  # noqa: F401  (statusline.py's import set, see above)
import importlib.util
import json
import os  # noqa: F401
import re  # noqa: F401
import shutil  # noqa: F401
import subprocess  # noqa: F401
import sys
import tempfile  # noqa: F401
import time


def load_block(path):
    """Import scripts/statusline-block.py as a module so the real fd_post is what gets timed."""
    spec = importlib.util.spec_from_file_location("fd_block", path)
    if spec is None or spec.loader is None:
        raise SystemExit("cannot load %s" % path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    block, payload_file, reps = sys.argv[1], sys.argv[2], int(sys.argv[3])
    module = load_block(block)
    with open(payload_file, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    timings = []
    for _ in range(reps):
        started = time.perf_counter()
        module.fd_post(payload)
        timings.append((time.perf_counter() - started) * 1000.0)

    json.dump({"first": timings[0], "rest": timings[1:]}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
