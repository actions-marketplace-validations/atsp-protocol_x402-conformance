# x402-conformance

**Experimental.** These are conformance and safety checks for [x402](https://github.com/coinbase/x402) V2
facilitators and resource servers, starting with Solana. The suite complements x402 and its facilitators and does
not replace them. It checks the properties a seller's money depends on: no double credit, nothing credited before
finality, replays rejected, dust rejected, idempotent settles, pending settlements that resolve instead of being
burned, and fail-closed handling of bad facilitator responses.

Status: v0.1.0 prototype. It has **no users yet**. It is part of my live experimental discovery run to
ascertain agent activity and bounds (ATSP World). — Ryan Gillespie, Optitransfer

## Why
x402 V2 already specifies these properties. The SVM `exact` scheme describes a duplicate-settlement race and
recommends a `duplicate_settlement` cache. V2 §9 makes `settlement_pending` non-terminal. The Solana guide says
"A retry cannot settle or fulfill the same purchase twice". What's missing is a shared, reproducible way to test
that a given facilitator, and the resource server in front of it, actually behaves that way. This repo is a first
step towards that test.

## Quickstart
    git clone https://github.com/atsp-protocol/x402-conformance && cd x402-conformance
    PYTHONPATH=src python3 -m unittest discover -s tests            # S1-S4, F1-F9 and the evidence check
    PYTHONPATH=src python3 -m x402conf offline                       # F1-F9 against the reference and faulty doubles
    PYTHONPATH=src python3 -m x402conf live https://x402.org/facilitator   # GET /supported only
    (cd lean && lake build && lake env lean Axioms.lean)              # Lean models, axioms check
    python3 tools/vv.py verify                                       # Proofline V&V of every acceptance criterion

There are no dependencies beyond Python 3.10 or later. Lean uses the toolchain pinned in `lean/lean-toolchain`.

## Checks
| id | what | mode |
|---|---|---|
| S1 | `GET /supported` has `kinds[]`, `extensions[]` and `signers{}` (V2 §7.3.1) | live, GET only |
| S2 | V2 kinds use CAIP-2 network IDs (V2 §11.1) | live, GET only |
| S3 | Solana V2 kinds use `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` or `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, not V1 names | live, GET only |
| S4 | Solana `exact` kinds have a valid `extra.feePayer` that is a listed signer | live, GET only |
| F1 | Malformed payload: `/verify` fails closed | offline now, devnet in M1 |
| F2 | Dust or underpayment rejected | offline now, devnet in M1 |
| F3 | Same payload settled twice: at most one success | offline now, devnet in M1 |
| F4 | Used memo or nonce replayed in a new transaction: rejected | offline now, devnet in M1 |
| F5 | No success before confirmation; `settlement_pending` carries a transaction | offline now, devnet in M1 |
| F6 | Facilitator timeout or garbage response: no credit | offline now, devnet in M1 |
| F7 | A `settlement_pending` settle retried with the same body reaches its final result (the same transaction on success), credited exactly once | offline |
| F8 | A failure confirmed on chain after `settlement_pending` is terminal, never stuck pending | offline |
| F9 | A 503, a non-JSON page or a truncated `/settle` body: never credited, and a retry then credits exactly once | offline |

F1 to F5 and F7 to F9 each have a faulty double that breaks that one rule and must fail it, while the reference
double passes all nine. F6 and F9 run the resource-server guard. Two of the faulty doubles (`success_before_final` and
`burn_on_pending`) also trip F9, because a guard can only recover a lost answer if the facilitator answered
honestly in the first place.

docs/SPEC.md quotes the spec text behind each check. Passing a check is evidence about one property. It does not
certify conformance to x402.

## Results (2026-10-20, live, GET `/supported` only)
| facilitator | HTTP | S1 | S2 | S3 | S4 | Solana kinds advertised |
|---|---|---|---|---|---|---|
| x402.dexter.cash | 200 | pass | pass | pass | pass | exact (mainnet, devnet), tab, bridge |
| facilitator.payai.network | 200 | pass | pass | pass | pass | exact and batch-settlement (mainnet, devnet) |
| x402.org/facilitator | 200 | pass | pass | pass | pass | exact (devnet) |

Raw bodies, `run.json` and `SHA256SUMS` are in [evidence/2026-10-20](evidence/2026-10-20). These static checks are
necessary but not sufficient. The safety properties come from F1 to F9. F1 to F6 will run on devnet once M1 lands.

## Use in CI
`action.yml` runs the same checks in a GitHub workflow. Live mode is GET `/supported` only; F1-F9 run offline.

    - uses: atsp-protocol/x402-conformance@main
      with:
        facilitators: https://x402.org/facilitator   # your facilitator's base URL; GET /supported only
        offline: "true"

A repository that runs it can show:

    [![x402-conformance](https://img.shields.io/badge/x402--conformance-checked-green)](https://github.com/atsp-protocol/x402-conformance)

## Lean
`lean/X402Conformance/Settlement.lean` proves `credit_sound`, `step_idem`, `step_nodup` and `run_nodup`.
`lean/X402Conformance/Nonce.lean` proves `consume_once` and `only_open_consumes`. Every one depends only on
`propext`. They model the credit rule the suite checks. They are not proofs about any facilitator's code.

## Scope, V&V and roadmap
- `proofline.json` is the scope contract. Every deliverable has acceptance criteria, and `tools/vv.py` verifies them in CI. The traceability matrix is in docs/VV.md. The contract is currently **unsigned and awaiting owner signature**.
- docs/ARCHITECTURE.md, docs/THREAT-MODEL.md and docs/ROADMAP.md cover the design, the threats and the milestones.

## Safety
The suite holds no keys and never signs or pays. Live mode is GET-only, and this is tested. To report a
vulnerability, see SECURITY.md (GitHub private vulnerability reporting).

## Licence
Apache-2.0. See LICENSE and NOTICE (Ryan Gillespie / Optitransfer).
