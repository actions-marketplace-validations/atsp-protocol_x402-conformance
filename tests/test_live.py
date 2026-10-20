"""S1-S4 over GET /supported bodies. No network: bodies are inline or come from the committed evidence."""

import glob
import json
import os
import unittest

from x402conf import harness as H
from x402conf import spec as S

FP = "DeXterR2kQm8AvRHnNPatWkE46TfAcMeBDjb6FySoAb8"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def fails(results):
    return {r["check"].split()[0] for r in results if not r["pass"]}


class Live(unittest.TestCase):
    def test_s_all_pass_on_conformant_body(self):
        doc = {"kinds": [{"x402Version": 2, "scheme": "exact", "network": S.SOLANA_DEVNET, "extra": {"feePayer": FP}}],
               "extensions": [], "signers": {"solana:*": [FP]}}
        self.assertEqual(fails(H.check_supported(doc)), set())

    def test_s1_shape(self):
        self.assertIn("S1", fails(H.check_supported({"kinds": {}})))

    def test_s2_non_caip2(self):
        doc = {"kinds": [{"x402Version": 2, "scheme": "exact", "network": "base sepolia"}], "extensions": [], "signers": {}}
        self.assertIn("S2", fails(H.check_supported(doc)))

    def test_s3_v1_name_in_v2(self):
        doc = {"kinds": [{"x402Version": 2, "scheme": "exact", "network": "solana-devnet"}], "extensions": [], "signers": {}}
        self.assertIn("S3", fails(H.check_supported(doc)))

    def test_s4_bad_fee_payer(self):
        doc = {"kinds": [{"x402Version": 2, "scheme": "exact", "network": S.SOLANA_MAINNET, "extra": {"feePayer": "x"}}],
               "extensions": [], "signers": {}}
        self.assertEqual(fails(H.check_supported(doc)), {"S4"})

    def test_s4_fee_payer_not_signer(self):
        doc = {"kinds": [{"x402Version": 2, "scheme": "exact", "network": S.SOLANA_MAINNET, "extra": {"feePayer": FP}}],
               "extensions": [], "signers": {"solana:*": ["11111111111111111111111111111111"]}}
        self.assertEqual(fails(H.check_supported(doc)), {"S4"})

    def test_live_mode_is_get_only(self):
        seen = []

        class R:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, n):
                return b'{"kinds":[],"extensions":[],"signers":{}}'

        def opener(req, timeout):
            seen.append(req.get_method())
            return R()

        H.run_live("https://f.example", opener=opener)
        self.assertEqual(seen, ["GET"])

    def test_committed_evidence_reproduces(self):
        """The committed bodies re-check to the committed verdicts."""
        runs = sorted(glob.glob(os.path.join(ROOT, "evidence", "*", "run.json")))
        self.assertTrue(runs)
        for run in runs:
            d = json.load(open(run))
            for r in d["results"]:
                if "body_sha256" not in r:
                    continue
                name = "supported-" + r["target"].split("//", 1)[-1].replace("/", "_") + ".json"
                body = json.load(open(os.path.join(os.path.dirname(run), name)))
                self.assertEqual([c["pass"] for c in H.check_supported(body)], [c["pass"] for c in r["checks"]])


if __name__ == "__main__":
    unittest.main()
