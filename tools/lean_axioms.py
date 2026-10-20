#!/usr/bin/env python3
"""Run lean/Axioms.lean and report, as one JSON line, how many theorems were printed and how many depend on an
axiom outside Lean's standard three (propext, Classical.choice, Quot.sound). sorryAx counts as unexpected."""
import json
import os
import re
import subprocess
import sys

STANDARD = {"propext", "Classical.choice", "Quot.sound"}
lean = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lean")
p = subprocess.run(["lake", "env", "lean", "Axioms.lean"], cwd=lean, capture_output=True, text=True, timeout=900)
out = p.stdout + p.stderr
rows = re.findall(r"'([^']+)' depends on axioms: \[([^\]]*)\]", out)
clean = re.findall(r"'([^']+)' does not depend on any axioms", out)
bad = [n for n, ax in rows if set(a.strip() for a in ax.split(",") if a.strip()) - STANDARD]
print(json.dumps({"exit": p.returncode, "theorems": len(rows) + len(clean), "unexpected_axioms": len(bad) + (p.returncode != 0),
                  "names": sorted([n for n, _ in rows] + clean), "bad": bad}))
sys.exit(0)
