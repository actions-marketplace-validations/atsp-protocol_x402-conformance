# Check specification

Each check below quotes the spec text it tests. Sources were read on 2026-10-20 at coinbase/x402 commit
`0e6e8c55d86b4f14234fb6e49a4052074fb93e57`: `specs/x402-specification-v2.md` (V2) and
`specs/schemes/exact/scheme_exact_svm.md` (SVM exact). The Solana guide is
https://solana.com/docs/payments/agentic-payments/x402.

These checks map behaviour to spec text. Passing them is evidence about specific properties. It is not
certification of conformance to x402.

| id | property | spec text | test |
|---|---|---|---|
| S1 | `GET /supported` returns `kinds[]`, `extensions[]` and `signers{}` | V2 §7.3.1 SupportedResponse fields: `kinds` array (required), `extensions` array (required), `signers` object (required), "Map of CAIP-2 patterns ... to public signer addresses" | `tests.test_live.Live.test_s1_shape` |
| S2 | Every `x402Version: 2` kind names its network in CAIP-2 | V2 §11.1 "Networks in x402 v2 use CAIP-2 ... format: `namespace:reference`" | `tests.test_live.Live.test_s2_non_caip2` |
| S3 | Solana V2 kinds use the published IDs | Solana guide: Mainnet `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, Devnet `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`; "V1 integrations used ... network names such as `solana-devnet`. Do not use those V1 fields in a new integration." | `tests.test_live.Live.test_s3_v1_name_in_v2` |
| S4 | Solana `exact` kinds advertise a valid `extra.feePayer` that is a listed signer | SVM exact: "`extra.feePayer`: The sponsor's public key"; V2 §7.3.1 `signers` | `tests.test_live.Live.test_s4_bad_fee_payer`, `test_s4_fee_payer_not_signer` |
| F1 | Malformed input fails closed | V2 §9 `invalid_payload`; SVM exact §2.1.2 "A transient failure ... MUST fail closed (reject / retryable), never open" | `tests.test_offline.Offline.test_f1_open_on_malformed_caught` |
| F2 | Dust and underpayment are rejected | SVM exact §1.1 "A transfer of at least `PaymentRequirements.amount`"; §1.4 "it MUST NOT be less" | `tests.test_offline.Offline.test_f2_accept_dust_caught` |
| F3 | The same payload settled twice succeeds at most once | SVM exact, Duplicate Settlement Mitigation: "if the key is already present in the cache, reject the settlement with a `\"duplicate_settlement\"` error" | `tests.test_offline.Offline.test_f3_no_dup_cache_caught` |
| F4 | Replaying a used memo or nonce in a new transaction is rejected | SVM exact §3.1 "The Memo instruction ensures transaction uniqueness"; Solana guide "The authorization is unexpired and has not been replayed" | `tests.test_offline.Offline.test_f4_no_memo_check_caught` |
| F5 | Nothing counts as settled before confirmation, and `settlement_pending` carries a transaction | V2 §9 `settlement_pending` is "non-terminal" and "MUST carry a non-empty `transaction`"; SVM invariant I3 "Settlement success returned only after confirming actual on-chain effects" | `tests.test_offline.Offline.test_f5_success_before_final_caught` |
| F6 | A facilitator timeout or malformed response never becomes a credit | Solana guide: "A retry cannot settle or fulfill the same purchase twice"; "Settlement reaches the confirmation level required before fulfillment" | `tests.test_offline.Offline.test_f6_guard_fails_closed_and_credits_once` |

## Lean models
| theorem | statement | file |
|---|---|---|
| `credit_sound` | Anything credited was a finalized success for at least the required amount (F2, F5) | `lean/X402Conformance/Settlement.lean` |
| `step_idem` | Settling the same outcome again changes nothing (F3) | same |
| `step_nodup`, `run_nodup` | No transaction is ever credited twice, over any sequence of outcomes (F3, F4) | same |
| `consume_once`, `only_open_consumes` | A nonce is consumed at most once (F4) | `lean/X402Conformance/Nonce.lean` |

All of these depend only on `propext` (`lean/Axioms.lean`, checked in CI). They are models of the rule the suite
checks. They are not proofs about any particular facilitator's code.
