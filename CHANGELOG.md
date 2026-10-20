# Changelog

## 1.0.0 (2026-10-20)
- GitHub Action `x402 Conformance` (`action.yml`): live S1-S4, resource-server checks R0-R9 and the offline F1-F9
  suite, with a job summary and a `result` output.
- TypeScript runner (`ts/`) for resource servers on `@x402/core` and `@x402/svm`: a facilitator double with fault
  modes and a probe of the paid route.
- Devnet runner (`x402conf devnet`): F1-F6 over real `/verify` and `/settle` against a self-hosted reference
  facilitator on Solana devnet, with fault-injected builds. Devnet evidence follows once the fee payer is funded.
- Lean: `Pending.lean` models timeouts, `settlement_pending` reconciliation and concurrent settles.
- The Proofline contract is signed by the owner key.
- docs/MATRIX.md and docs/MANAGED.md.

## Earlier, unreleased
- Fixed the reference facilitator double: it marked a payment as seen before the payment was final, so retrying a
  settle that was still `settlement_pending` came back as `duplicate_settlement` instead of the final result. That
  contradicts V2 §9, where `settlement_pending` is non-terminal. A payment is now recorded only once its outcome is
  final, and a confirmed on-chain failure answers `invalid_transaction_state` and stays terminal.
- New offline checks. F7: a pending settle retried with the same body reaches its final result and is credited exactly
  once. F8: a failure confirmed after pending is terminal and never stuck pending. F9: a 503, a non-JSON page or a
  truncated body is never credited, and the payment stays retryable. Each has a faulty double that must fail it
  (`burn_on_pending`, `stuck_pending`, and the guards `guard_trust_any_status` and `guard_give_up_after_error`).

## 0.1.0 (2026-10-20)
- First prototype. Live checks S1 to S4 read only `GET /supported`. Safety checks F1 to F6 run against in-process facilitator doubles, using devnet fixtures.
- Lean models: `credit_sound`, `step_idem`, `step_nodup` and `run_nodup` for the credit rule, plus `consume_once` and `only_open_consumes` for nonces. Every one of them depends only on `propext`.
- First evidence run (2026-10-20). Dexter, PayAI and the x402.org facilitator pass S1 to S4.
- A Proofline contract (`proofline.json`) with V&V tooling (`tools/vv.py`) and a traceability matrix (`docs/VV.md`). The contract is unsigned and awaiting the owner's signature.
