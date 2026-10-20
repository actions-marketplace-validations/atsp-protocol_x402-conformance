"""Command line.

    x402conf live <facilitator-base-url> ... [--evidence DIR]   GET /supported only
    x402conf offline                                           F1-F6 against the reference and faulty doubles"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time

from . import __version__
from . import harness as H
from . import mock as M


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="x402conf")
    sub = ap.add_subparsers(dest="mode", required=True)
    lv = sub.add_parser("live", help="GET /supported only; never signs, pays or POSTs")
    lv.add_argument("targets", nargs="+")
    lv.add_argument("--evidence", help="directory for raw bodies, run.json and SHA256SUMS")
    sub.add_parser("offline", help="safety checks against in-process doubles")
    a = ap.parse_args(argv)
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if a.mode == "live":
        runs = [H.run_live(t) for t in a.targets]
        sums = []
        for r in runs:
            raw = r.pop("raw", None)
            if raw is not None:
                r["body_sha256"] = hashlib.sha256(raw).hexdigest()
                if a.evidence:
                    os.makedirs(a.evidence, exist_ok=True)
                    name = "supported-" + r["target"].split("//", 1)[-1].replace("/", "_") + ".json"
                    with open(os.path.join(a.evidence, name), "wb") as fb:
                        fb.write(raw)
                    sums.append(f"{r['body_sha256']}  {name}")
        out = {"tool": f"x402-conformance {__version__}", "run_at": stamp, "mode": "live-GET-only", "results": runs}
        text = json.dumps(out, indent=1, sort_keys=True)
        if a.evidence:
            with open(os.path.join(a.evidence, "run.json"), "w") as f:
                f.write(text + "\n")
            sums.append(hashlib.sha256((text + "\n").encode()).hexdigest() + "  run.json")
            with open(os.path.join(a.evidence, "SHA256SUMS"), "w") as f:
                f.write("\n".join(sorted(sums, key=lambda s: s.split("  ")[1])) + "\n")
        print(text)
        return 0
    res = {k: H.check_safety(f(), M.vectors()) for k, f in M.FAULTS.items()}
    print(json.dumps({"tool": f"x402-conformance {__version__}", "run_at": stamp, "mode": "offline", "results": res},
                     indent=1))
    ref_ok = all(r["pass"] for r in res["reference"])
    caught = all(any(not r["pass"] for r in v) for k, v in res.items() if k != "reference")
    return 0 if ref_ok and caught else 1


if __name__ == "__main__":
    sys.exit(main())
