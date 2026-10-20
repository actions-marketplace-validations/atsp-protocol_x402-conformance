# Changelog

## 0.1.0 (2026-10-20)
- First prototype. Live checks S1 to S4 read only `GET /supported`. Safety checks F1 to F6 run against in-process facilitator doubles, using devnet fixtures.
- Lean models: `credit_sound`, `step_idem`, `step_nodup` and `run_nodup` for the credit rule, plus `consume_once` and `only_open_consumes` for nonces. Every one of them depends only on `propext`.
- First evidence run (2026-10-20). Dexter, PayAI and the x402.org facilitator pass S1 to S4.
- A Proofline contract (`proofline.json`) with V&V tooling (`tools/vv.py`) and a traceability matrix (`docs/VV.md`). The contract is unsigned and awaiting the owner's signature.
