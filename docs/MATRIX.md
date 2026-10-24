# Facilitator matrix

Devnet results for x402 V2 facilitators on Solana: F1 to F6 over real `/verify` and `/settle`, run by
`x402conf devnet`. I run it against a third-party facilitator only with that operator's written **permission**,
and only on devnet. Each third-party report will sit in `evidence/matrix/<operator>.json` with its permission record linked below.

Disclosure: a failing check in someone else's facilitator goes to that operator privately first. I publish it only
after a fix or 90 days after the report, whichever is first (SECURITY.md). Until then the row says "under disclosure".

| facilitator | operator permission | devnet run | F1 | F2 | F3 | F4 | F5 | F6 | disclosure status |
|---|---|---|---|---|---|---|---|---|---|
| self-hosted reference (@x402/core + @x402/svm 2.28.0) | mine, not needed | [2026-10-20](../evidence/devnet) | pass | pass | pass | **fail** | pass | pass | n/a: my own instance of open-source code |
| facilitator.payai.network | not yet requested | none | | | | | | | n/a |
| facilitator.x402.rs | not yet requested | none | | | | | | | n/a |
| x402.dexter.cash | not yet requested | none | | | | | | | n/a |
| x402.org/facilitator | not yet requested | none | | | | | | | n/a |
| facilitator.daydreams.systems | not yet requested | none | | | | | | | n/a |
| facilitator.goplausible.xyz | not yet requested | none | | | | | | | n/a |
| facilitator.ultravioletadao.xyz | not yet requested | none | | | | | | | n/a |

In the live run of 2026-10-20 ([evidence/2026-10-20-v1.3.0](../evidence/2026-10-20-v1.3.0)), seven named facilitators advertise a V2 `exact` kind on Solana devnet in `GET /supported`: the seven above. One more is withheld in that run. XC-M2 is done when at least
three facilitators have a report here, each with its permission recorded. No third-party report exists yet.

The F4 failure on the reference is explained in [evidence/devnet](../evidence/devnet): it deduplicates by
transaction, not by memo, so two different transactions with the same memo both settle.

Want your facilitator in the matrix? Open an issue and say so. The issue is the permission record.

## Self-hosted open-source facilitators

Seventeen facilitators publish their source and can run on my own machine. I build each one at a pinned commit, start it
on 127.0.0.1 against public testnets with throwaway keys, and run the suite against that loopback instance: `x402conf live`
(S0 to S4) today, and the verify-only F checks on Base Sepolia once XC-51 lands. No hosted instance is called and no operator
permission is needed, because the instance is mine (the same footing as the self-hosted reference above). A failing check
still goes to the project privately first (SECURITY.md); until then its row says "under disclosure".

| facilitator | source @ pin | networks | suite today | status |
|---|---|---|---|---|
| x402 TypeScript example | x402-foundation/x402 @ 2cf50eb | Base Sepolia, Solana devnet | S0-S4 on loopback | run on loopback 2026-10-24; F checks with XC-51 |
| x402 Python example | x402-foundation/x402 @ 2cf50eb | Base Sepolia, Solana devnet | S0-S4 on loopback | as above |
| x402 Go example | x402-foundation/x402 @ 2cf50eb | Base Sepolia, Solana devnet | S0-S4 on loopback | as above |
| x402-rs | x402-rs/x402-rs @ e75adda | Base Sepolia | S0-S4 on loopback | as above |
| qntx facilitator | qntx/facilitator @ df75698 | Base Sepolia | S0-S4 on loopback | as above |
| faremeter | faremeter/faremeter @ 68e024e | Base Sepolia, SKALE and Monad testnets | S0-S4 on loopback | as above |
| daydreams | daydreamsai/facilitator @ 9d99d61 | Base Sepolia | S0-S4 on loopback (bearer token) | as above |
| mogami | mogami-tech/x402-facilitator @ 8e76b2d | Base Sepolia | S0-S4 on loopback | as above |
| raid-guild | raid-guild/x402-facilitator-go @ 83744bf | Base Sepolia | S0-S4 on loopback | as above |
| agent-guide go-x402-facilitator | agent-guide/go-x402-facilitator @ 164747c | Base Sepolia (V1) | S0-S4 on loopback | V1 only |
| Stellar x402 | stellar/x402-stellar @ 953caa5 | Stellar testnet | S0-S4 on loopback | F checks need a Stellar `exact` client |
| Accensa Stellar | accensa/x402-facilitator-stellar @ 016c16b | Stellar testnet | S0-S4 on loopback | as above |
| Casper x402 | make-software/casper-x402 @ 3ee705e | Casper testnet | S0-S4 on loopback | F checks need a Casper client |
| Fireblocks | fireblocks/x402-facilitator @ ca7dd59 | Base Sepolia | not yet | a payments API, not the facilitator API; needs a custody key |
| OpenZeppelin relayer plugin | OpenZeppelin/relayer-plugin-x402-facilitator @ 831fb05 | Stellar testnet | not yet | runs only inside an OpenZeppelin Relayer |
| TRDEFI Arc | TRDEFI/arc-x402-facilitator @ efbe999 | Arc | not yet | no testnet configuration at this pin |
| PipRail | piprail/piprail @ a8d7c35 | none | n/a | a facilitator client, no server |

## Implementation matrix

<!-- compat-matrix:start -->

Stock example servers at pinned SDK versions, probed on loopback behind the facilitator double (R0 to R10). Generated by `python3 tools/compat_matrix.py --write` from `evidence/impl-matrix/*/run.json`; CI fails when this table or `docs/compat-matrix.json` is stale, a row has no hashes, or a hash does not match its file. Each row links the run it was built from and the `SHA256SUMS` that pins it.

| row | stack | version | network | checks | failed | run | hashes |
|---|---|---|---|---|---|---|---|
| express-2.27.0 | express | 2.27.0 | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | 11 | none | [run.json](../evidence/impl-matrix/express-2.27.0/run.json) | [`4cb84a761d1f`](../evidence/impl-matrix/express-2.27.0/SHA256SUMS) |
| express-2.28.0 | express | 2.28.0 | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | 11 | none | [run.json](../evidence/impl-matrix/express-2.28.0/run.json) | [`dc7730d56b44`](../evidence/impl-matrix/express-2.28.0/SHA256SUMS) |
| fastapi-2.25.0 | fastapi | 2.25.0 | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | 11 | none | [run.json](../evidence/impl-matrix/fastapi-2.25.0/run.json) | [`de0969cd88e4`](../evidence/impl-matrix/fastapi-2.25.0/SHA256SUMS) |
| flask-2.25.0 | flask | 2.25.0 | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | 11 | none | [run.json](../evidence/impl-matrix/flask-2.25.0/run.json) | [`eae4e6e5f705`](../evidence/impl-matrix/flask-2.25.0/SHA256SUMS) |
| hono-2.28.0 | hono | 2.28.0 | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | 11 | none | [run.json](../evidence/impl-matrix/hono-2.28.0/run.json) | [`892b9a4a29d0`](../evidence/impl-matrix/hono-2.28.0/SHA256SUMS) |

<!-- compat-matrix:end -->
