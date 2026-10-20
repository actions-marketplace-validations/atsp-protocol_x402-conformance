"""F1-F9: the reference double passes; each faulty double is caught by the check that targets it."""

import unittest

from x402conf import harness as H
from x402conf import mock as M
from x402conf import spec as S


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

    def test_f7_burn_on_pending_caught(self):
        self.assertIn("F7", fails(H.check_safety(M.Faulty(burn_on_pending=True), M.vectors())))

    def test_f8_stuck_pending_caught(self):
        self.assertIn("F8", fails(H.check_safety(M.Faulty(stuck_pending=True), M.vectors())))

    def test_f9_guard_trusting_a_503_caught(self):
        g = H.GUARD_FAULTS["guard_trust_any_status"]
        self.assertEqual(fails(H.check_safety(M.Reference(), M.vectors(), guard=g)), {"F9"})

    def test_f9_guard_that_never_retries_caught(self):
        g = H.GUARD_FAULTS["guard_give_up_after_error"]
        self.assertEqual(fails(H.check_safety(M.Reference(), M.vectors(), guard=g)), {"F9"})

    def test_reference_pending_retry_reaches_final_and_credits_once(self):
        fac, v = M.Reference(), M.vectors()
        p, req = v("pending_ok"), v("req")
        g = H.ResourceServerGuard(fac)
        first = fac.settle(p, req)
        self.assertEqual((first["errorReason"], first["transaction"]), (S.SETTLEMENT_PENDING, p["tx"]))
        self.assertFalse(g.settle_and_credit(p, req))          # still pending: retried, not a duplicate, no credit
        self.assertEqual(fac.settle(p, req)["errorReason"], S.SETTLEMENT_PENDING)
        fac.chain.set(p["tx"], M.Chain.CONFIRMED)
        self.assertTrue(g.settle_and_credit(p, req))           # same body, final success, credited once
        again = fac.settle(p, req)
        self.assertEqual(again["errorReason"], S.DUPLICATE_SETTLEMENT)   # a true duplicate after final success
        self.assertFalse(g.settle_and_credit(p, req))
        self.assertEqual(g.credited, {p["tx"]})

    def test_reference_failure_after_pending_is_terminal(self):
        fac, v = M.Reference(), M.vectors()
        p, req = v("pending_fail"), v("req")
        self.assertEqual(fac.settle(p, req)["errorReason"], S.SETTLEMENT_PENDING)
        fac.chain.set(p["tx"], M.Chain.FAILED)
        for _ in range(3):
            r = fac.settle(p, req)
            self.assertEqual((r["success"], r["errorReason"]), (False, S.INVALID_TRANSACTION_STATE))
        fac.chain.set(p["tx"], M.Chain.CONFIRMED)              # a failed transaction never turns into a success
        self.assertEqual(fac.settle(p, req)["errorReason"], S.INVALID_TRANSACTION_STATE)

    def test_guard_never_credits_503_non_json_or_truncated_and_retries(self):
        fac, v = M.Reference(), M.vectors()
        p, req = v("transport_retry"), v("req")
        g = H.ResourceServerGuard(fac)
        for mode in ("http503", "non_json", "truncated"):
            self.assertFalse(g.settle_and_credit(p, req, simulate=mode), mode)
        self.assertEqual(g.credited, set())
        fac.chain.set(p["tx"], M.Chain.CONFIRMED)
        self.assertTrue(g.settle_and_credit(p, req))
        self.assertFalse(g.settle_and_credit(p, req))

    def test_devnet_fixture_targets_devnet(self):
        fx = M.load_fixture("devnet")
        self.assertEqual(fx["requirements"]["network"], "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")


if __name__ == "__main__":
    unittest.main()
