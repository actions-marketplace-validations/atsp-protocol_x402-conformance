# Facilitator matrix (XC-M2)

Devnet results for x402 V2 facilitators on Solana: F1 to F6 over real `/verify` and `/settle`, run by
`x402conf devnet`. I run it against a third-party facilitator only with that operator's written **permission**,
and only on devnet. Each report sits in `evidence/matrix/<operator>.json` with its permission record linked below.

Disclosure: a failing check in someone else's facilitator goes to that operator privately first. I publish it only
after a fix or 90 days after the report, whichever is first (SECURITY.md). Until then the row says "under disclosure".

| facilitator | operator permission | devnet run | F1 | F2 | F3 | F4 | F5 | F6 | disclosure status |
|---|---|---|---|---|---|---|---|---|---|
| self-hosted reference (@x402/core + @x402/svm 2.28.0) | mine, not needed | pending (fee payer awaiting devnet faucet SOL) | | | | | | | n/a |
| facilitator.payai.network | not yet requested | none | | | | | | | n/a |
| facilitator.x402.rs | not yet requested | none | | | | | | | n/a |
| x402.dexter.cash | not yet requested | none | | | | | | | n/a |
| x402.org/facilitator | not yet requested | none | | | | | | | n/a |
| facilitator.daydreams.systems | not yet requested | none | | | | | | | n/a |

These five advertise Solana devnet in `GET /supported` (live run of 2026-10-20). XC-M2 is done when at least
three facilitators have a report here, each with its permission recorded. No such report exists yet.

Want your facilitator in the matrix? Open an issue and say so. The issue is the permission record.
