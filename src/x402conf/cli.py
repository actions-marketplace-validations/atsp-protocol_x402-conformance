"""Command line.

    x402conf live <facilitator-base-url> ... [--evidence DIR]   GET /supported only
    x402conf offline                                           F1-F9 against the reference and faulty doubles
    x402conf devnet [--faults] [--evidence DIR] ...             F1-F6 over real /verify and /settle on Solana devnet
    x402conf report [--dir DIR] [--sarif FILE] [--junit FILE]   SARIF 2.1.0 and JUnit XML from the results JSON"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from typing import Any
from xml.sax.saxutils import quoteattr

from . import __version__
from . import harness as H
from . import mock as M

DOCS = "https://github.com/atsp-protocol/x402-conformance/blob/main/docs/"


def collect(d: str) -> list[dict[str, Any]]:
    """One row per check from live.json, resource-server.json and offline.json in d, the files the Action writes.

    Offline rows cover the reference double only, plus one row saying whether every fault-injected double was caught:
    a fault-injected double failing its target check is the expected result, not a finding."""
    rows: list[dict[str, Any]] = []

    def load(name: str) -> Any:
        p = os.path.join(d, name)
        if not os.path.exists(p):
            return None
        with open(p) as f:
            return json.load(f)

    def row(target: str, check: str, ok: bool, severity: str, detail: Any, source: str) -> None:
        rows.append({"id": check.split()[0], "target": target, "check": check, "pass": bool(ok),
                     "severity": severity, "detail": detail, "source": source})

    for r in (load("live.json") or {}).get("results", []):
        if r.get("error"):
            row(r["target"], "S0 GET /supported answered with parseable JSON", False, "error", r["error"], "live.json")
        for c in r.get("checks", []):
            row(r["target"], c["check"], c["pass"], c.get("severity", "error"), c.get("detail"), "live.json")
    rsv = load("resource-server.json")
    if rsv is not None:
        for c in rsv.get("results", []):
            row(rsv["resource"], c["check"], c["pass"], "error", c.get("detail"), "resource-server.json")
    off = load("offline.json")
    if off is not None:
        res = off["results"]
        for c in res["reference"]:
            row("reference double", c["check"], c["pass"], c.get("severity", "error"), c.get("detail"), "offline.json")
        missed = [k for k, v in res.items() if k != "reference" and all(c["pass"] for c in v)]
        row("fault-injected doubles", "FX every fault-injected double is caught by at least one check", not missed,
            "error", {"uncaught": missed}, "offline.json")
    return rows


def anchor(check_id: str) -> str:
    return DOCS + "FIXES.md#" + check_id.lower()


def sarif(rows: list[dict[str, Any]], results_dir: str) -> dict[str, Any]:
    """SARIF 2.1.0 for GitHub code scanning: one rule per check id, one result per failed check.

    A result points at the results file it came from, because a failed x402 check is a property of a running service,
    not of a line of source code."""
    rules: dict[str, dict[str, Any]] = {}
    for r in rows:
        rules.setdefault(r["id"], {
            "id": r["id"], "name": "x402" + r["id"],
            "shortDescription": {"text": r["check"][len(r["id"]):].strip() or r["id"]},
            "helpUri": anchor(r["id"]),
            "help": {"text": f"What failed and how to fix it: {anchor(r['id'])}"},
            "properties": {"tags": ["x402", "payments", "security"]},
        })
    ids = sorted(rules)
    results = []
    for r in rows:
        if r["pass"]:
            continue
        key = hashlib.sha256(f"{r['target']}|{r['id']}".encode()).hexdigest()
        detail = json.dumps(r["detail"], sort_keys=True)[:500]
        results.append({
            "ruleId": r["id"], "ruleIndex": ids.index(r["id"]),
            "level": "error" if r["severity"] == "error" else "note",
            "message": {"text": f"{r['target']}: {r['check']} failed. Detail: {detail}. Fix: {anchor(r['id'])}"},
            "locations": [{"physicalLocation": {"artifactLocation": {
                "uri": os.path.join(results_dir, r["source"]).replace(os.sep, "/")}}}],
            "partialFingerprints": {"x402ConformanceCheck/v1": key},
        })
    return {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json", "version": "2.1.0",
        "runs": [{"tool": {"driver": {"name": "x402-conformance", "version": __version__,
                                      "informationUri": "https://github.com/atsp-protocol/x402-conformance",
                                      "rules": [rules[i] for i in ids]}},
                  "results": results}],
    }


def junit(rows: list[dict[str, Any]]) -> str:
    """JUnit XML: one test suite per target, one test case per check. Info-severity failures are reported as skipped."""
    suites: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        suites.setdefault(r["target"], []).append(r)
    fails = sum(1 for r in rows if not r["pass"] and r["severity"] == "error")
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           f'<testsuites name="x402-conformance" tests="{len(rows)}" failures="{fails}">']
    for target, rs in suites.items():
        nf = sum(1 for r in rs if not r["pass"] and r["severity"] == "error")
        ns = sum(1 for r in rs if not r["pass"] and r["severity"] != "error")
        out.append(f'  <testsuite name={quoteattr(target)} tests="{len(rs)}" failures="{nf}" skipped="{ns}">')
        for r in rs:
            case = f'    <testcase classname={quoteattr("x402." + r["id"])} name={quoteattr(r["check"])}'
            if r["pass"]:
                out.append(case + "/>")
                continue
            msg = quoteattr(f"{r['id']} failed; how to fix it: {anchor(r['id'])}")
            body = json.dumps(r["detail"], sort_keys=True)[:2000]
            body = body.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            tag = "failure" if r["severity"] == "error" else "skipped"
            out += [case + ">", f"      <{tag} message={msg}>{body}</{tag}>", "    </testcase>"]
        out.append("  </testsuite>")
    out.append("</testsuites>")
    return "\n".join(out) + "\n"


def report(args: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="x402conf report",
                                 description="Convert live.json, resource-server.json and offline.json to SARIF or JUnit")
    ap.add_argument("--dir", default="x402-conformance", help="directory holding the results JSON files")
    ap.add_argument("--sarif", help="write SARIF 2.1.0 here (for GitHub code scanning)")
    ap.add_argument("--junit", help="write JUnit XML here (for test-report viewers)")
    a = ap.parse_args(args)
    rows = collect(a.dir)
    if not rows:
        print(f"no results JSON found in {a.dir}", file=sys.stderr)
        return 2
    if a.sarif:
        with open(a.sarif, "w") as f:
            json.dump(sarif(rows, a.dir), f, indent=1)
            f.write("\n")
    if a.junit:
        with open(a.junit, "w") as f:
            f.write(junit(rows))
    bad = [r for r in rows if not r["pass"] and r["severity"] == "error"]
    print(json.dumps({"checks": len(rows), "failed": len(bad), "failed_ids": sorted({r["id"] for r in bad})}))
    return 0


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if args[:1] == ["devnet"]:
        from .devnet import runner

        return runner.main(args[1:])
    if args[:1] == ["report"]:
        return report(args[1:])
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
    res.update({k: H.check_safety(M.Reference(), M.vectors(), guard=g) for k, g in H.GUARD_FAULTS.items()})
    print(json.dumps({"tool": f"x402-conformance {__version__}", "run_at": stamp, "mode": "offline", "results": res},
                     indent=1))
    ref_ok = all(r["pass"] for r in res["reference"])
    caught = all(any(not r["pass"] for r in v) for k, v in res.items() if k != "reference")
    return 0 if ref_ok and caught else 1


if __name__ == "__main__":
    sys.exit(main())
