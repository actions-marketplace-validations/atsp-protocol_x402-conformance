# Architecture

Status: experimental, v0.1.0. Part of a live experimental discovery run, so expect changes.

```mermaid
flowchart LR
  subgraph suite[x402-conformance]
    CLI[x402conf CLI] --> LIVE[Live checks S1-S4<br/>GET /supported only]
    CLI --> OFF[Safety checks F1-F9]
    OFF --> DOUBLES[Facilitator doubles<br/>Reference + Faulty]
    OFF -. M1 .-> DEVNET[Devnet runner<br/>operator-owned facilitator]
    GUARD[ResourceServerGuard<br/>credit rule] --- OFF
    LEAN[lean/ proofs<br/>Settlement, Nonce] -. models .- GUARD
    VV[tools/vv.py<br/>Proofline V&V] --> RCPT[receipts]
  end
  LIVE -->|GET| PUB[(Public facilitators)]
  DEVNET -->|/verify /settle| OWN[(Facilitator under test<br/>on Solana devnet)]
  LIVE --> EVID[evidence/DATE<br/>raw bodies + SHA256SUMS]
```

## Components
| path | role |
|---|---|
| `src/x402conf/spec.py` | Identifiers quoted from the x402 V2 spec and the Solana `exact` scheme (CAIP-2 IDs, error codes) |
| `src/x402conf/harness.py` | The checks. `run_live` makes exactly one GET per target. `check_safety` runs F1 to F6 against anything that has `verify` and `settle`, and F7 to F9 against a double whose simulated chain it can advance between retries |
| `src/x402conf/mock.py` | The `Reference` double, which behaves as the spec asks, and `Faulty` doubles, each reproducing one known failure. `Chain` is the simulated ledger F7 to F9 advance |
| `src/x402conf/fixtures/devnet.json` | Devnet requirements (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, devnet USDC) and the test vectors |
| `lean/` | Lean 4 models of the credit rule and the nonce state machine, built by `lake build` |
| `tools/vv.py` | Verifies every Proofline criterion in `proofline.json` and writes receipts |
| `evidence/` | Dated live results with raw bodies and hashes |

## Boundaries
- Live mode is GET-only, and this is enforced in code and tested (`test_live_mode_is_get_only`).
- The suite holds no keys. Once M1 lands, devnet runs will use throwaway devnet keypairs created for each run and never committed.
- No mainnet payments, ever.
