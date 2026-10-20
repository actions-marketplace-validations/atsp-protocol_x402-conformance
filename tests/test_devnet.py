"""The devnet runner, offline: run_checks over real HTTP against a loopback facilitator double with a simulated chain,
and the owner-rule refusals. No network beyond loopback, no keys."""

import base64
import hashlib
import json
import os
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from x402conf import spec as S
from x402conf.devnet import runner as R

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVIDENCE = os.path.join(ROOT, "evidence", "devnet")
REQ = {"scheme": "exact", "network": S.SOLANA_DEVNET, "asset": "Mint1111111111111111111111111111111111111111",
       "amount": "10000", "payTo": "PayTo111111111111111111111111111111111111111", "maxTimeoutSeconds": 60,
       "extra": {"feePayer": "Fee11111111111111111111111111111111111111111"}}


class Chain:
    def __init__(self):
        self.sigs, self.bal = {}, 0

    def status(self, sig):
        return self.sigs.get(sig)

    def balance(self, account):
        return self.bal


class Payer:
    n = 0

    def build(self, req):
        Payer.n += 1
        tx = {"id": f"sig-{Payer.n}", "amount": int(req["amount"]), "memo": req["extra"].get("memo", f"rnd-{Payer.n}")}
        wire = base64.b64encode(json.dumps(tx).encode()).decode()
        return {"x402Version": 2, "accepted": req, "payload": {"transaction": wire}}


def make_server(chain, faults=()):
    settled, memos = set(), set()

    def decode(p):
        try:
            return json.loads(base64.b64decode(p["payload"]["transaction"]))
        except Exception:  # noqa: BLE001
            return None

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["content-length"])))
            if self.path.startswith("/slow/"):
                time.sleep(0.5)
            p, req = body["paymentPayload"], body["paymentRequirements"]
            tx = decode(p)
            if self.path.endswith("/verify"):
                if tx is None:
                    out = {"isValid": "open_on_malformed" in faults}
                elif tx["amount"] < int(req["amount"]) and "accept_dust" not in faults:
                    out = {"isValid": False, "invalidReason": "insufficient_funds"}
                else:
                    out = {"isValid": True}
            elif "success_unsent" in faults:
                out = {"success": True, "transaction": tx["id"]}
            elif tx["id"] in settled and "no_dup_cache" not in faults:
                out = {"success": False, "errorReason": S.DUPLICATE_SETTLEMENT, "transaction": ""}
            elif tx["memo"] in memos and "no_memo_check" not in faults:
                out = {"success": False, "errorReason": "invalid_exact_svm_payload_memo_reused", "transaction": ""}
            else:
                settled.add(tx["id"])
                memos.add(tx["memo"])
                chain.sigs[tx["id"]] = "confirmed"
                chain.bal += tx["amount"]
                out = {"success": True, "transaction": tx["id"], "network": req["network"]}
            raw = json.dumps(out).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def run(faults=()):
    chain = Chain()
    srv, url = make_server(chain, faults)
    try:
        res = R.run_checks(R.HttpFacilitator(url), Payer(), chain, REQ, "ata", settle_wait=0,
                           slow=lambda: R.HttpFacilitator(url + "/slow", timeout=0.05))
    finally:
        srv.shutdown()
    return {r["check"].split()[0] for r in res if not r["pass"]}, res


class Devnet(unittest.TestCase):
    def test_reference_double_passes_f1_to_f6(self):
        failed, res = run()
        self.assertEqual(failed, set())
        self.assertEqual([r["check"].split()[0] for r in res], ["F1", "F2", "F3", "F4", "F5", "F6"])

    def test_f1_open_on_malformed_caught(self):
        self.assertIn("F1", run({"open_on_malformed"})[0])

    def test_f2_accept_dust_caught(self):
        self.assertIn("F2", run({"accept_dust"})[0])

    def test_f3_no_dup_cache_caught(self):
        self.assertIn("F3", run({"no_dup_cache", "no_memo_check"})[0])

    def test_f4_memo_replay_caught(self):
        self.assertIn("F4", run({"no_memo_check"})[0])

    def test_f5_success_unsent_caught(self):
        self.assertIn("F5", run({"success_unsent"})[0])

    def test_refuses_third_party_without_permission(self):
        with self.assertRaises(R.Refused):
            R.HttpFacilitator("https://facilitator.example.com")
        R.HttpFacilitator("https://facilitator.example.com", permission="operator email of 2026-10-20")
        R.HttpFacilitator("http://127.0.0.1:4021")

    def test_refuses_non_devnet_requirements(self):
        fac = R.HttpFacilitator("http://127.0.0.1:9")
        with self.assertRaises(R.Refused):
            fac.verify({}, dict(REQ, network=S.SOLANA_MAINNET))


    def test_committed_devnet_evidence(self):
        with open(os.path.join(EVIDENCE, "SHA256SUMS")) as f:
            sums = [line.split("  ") for line in f.read().splitlines() if line]
        for digest, name in sums:
            with open(os.path.join(EVIDENCE, name), "rb") as fb:
                self.assertEqual(hashlib.sha256(fb.read()).hexdigest(), digest)
        with open(os.path.join(EVIDENCE, "run.json")) as f:
            run_doc = json.load(f)
        self.assertEqual(run_doc["network"], S.SOLANA_DEVNET)
        self.assertNotIn(S.SOLANA_MAINNET, json.dumps(run_doc))
        self.assertTrue(run_doc["results"]["reference"]["self_hosted"])
        self.assertEqual(len(run_doc["results"]["reference"]["checks"]), 6)


if __name__ == "__main__":
    unittest.main()
