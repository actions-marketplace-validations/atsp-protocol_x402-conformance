"""F1-F6: the reference double passes; each faulty double is caught by the check that targets it."""

import unittest

from x402conf import harness as H
from x402conf import mock as M


def fails(results):
    return {r["check"].split()[0] for r in results if not r["pass"]}


class Offline(unittest.TestCase):
    def test_reference_passes_all(self):
        self.assertEqual(fails(H.check_safety(M.Reference(), M.vectors())), set())

    def test_f1_open_on_malformed_caught(self):
        self.assertIn("F1", fails(H.check_safety(M.Faulty(open_on_malformed=True), M.vectors())))

    def test_f2_accept_dust_caught(self):
        self.assertIn("F2", fails(H.check_safety(M.Faulty(accept_dust=True), M.vectors())))

    def test_f3_no_dup_cache_caught(self):
        self.assertIn("F3", fails(H.check_safety(M.Faulty(no_dup_cache=True), M.vectors())))

    def test_f4_no_memo_check_caught(self):
        self.assertIn("F4", fails(H.check_safety(M.Faulty(no_memo_check=True), M.vectors())))

    def test_f5_success_before_final_caught(self):
        self.assertIn("F5", fails(H.check_safety(M.Faulty(success_before_final=True), M.vectors())))

    def test_f6_guard_fails_closed_and_credits_once(self):
        g = H.ResourceServerGuard(M.Reference())
        v = M.vectors()
        self.assertFalse(g.settle_and_credit(v("good"), v("req"), simulate="timeout"))
        self.assertFalse(g.settle_and_credit(v("good"), v("req"), simulate="garbage"))
        self.assertTrue(g.settle_and_credit(v("good"), v("req")))
        self.assertFalse(g.settle_and_credit(v("good"), v("req")))
        self.assertFalse(g.settle_and_credit(v("unfinalized"), v("req")))

    def test_devnet_fixture_targets_devnet(self):
        fx = M.load_fixture("devnet")
        self.assertEqual(fx["requirements"]["network"], "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")


if __name__ == "__main__":
    unittest.main()
