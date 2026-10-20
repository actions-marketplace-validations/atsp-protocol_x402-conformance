# Roadmap

v0.1.0 (this release) is the prototype: S1 to S4 run live with GET only, F1 to F6 run against in-process doubles,
the Lean models are in place, and the first evidence run is committed. There are no users yet.

The milestones below are my proposal for the Solana Foundation grant application. Every milestone is a
Proofline task in `proofline.json` (XC-M1 to XC-M6), with acceptance criteria that CI verifies.

| id | deliverable | acceptance (summary) | budget (USD, my proposal) |
|---|---|---|---|
| M1 | **Devnet runner.** F1 to F6 run over real x402 V2 `/verify` and `/settle` against a facilitator on Solana devnet that I host myself, using throwaway devnet keypairs | `x402conf devnet` exits 0 against the self-hosted reference facilitator; each F check also fails against a fault-injected build; the devnet evidence is committed with hashes | 6,000 |
| M2 | **Facilitator matrix.** Results pages for at least 3 facilitators that offer Solana devnet, run only with each operator's permission | `evidence/matrix/` holds at least 3 facilitator reports; any failures go through the 90-day disclosure in SECURITY.md first | 5,000 |
| M3 | **Lean models extended.** Timeouts, `settlement_pending` reconciliation, and concurrent settles over a shared cache | New theorems build in CI with only standard axioms; each theorem is linked to its F check in docs/SPEC.md | 4,000 |
| M4 | **Drop-in CI action.** A GitHub Action plus a TypeScript runner for resource servers built on `@x402/svm` | The action runs F1 to F6 in another repo's CI, and an example repo is green | 4,000 |
| M5 | **Maintenance for 6 months.** Issues, spec updates and fixes | Monthly: open issues are triaged within 7 days and CI stays green on the current spec | 3,000 (500 a month) |
| M6 | **Adoption.** Paid in 25% steps | At least 3 external repos run the suite in CI (3,000); at least 5 facilitators have published results (2,000) | 5,000 |
| | **Total** | | **27,000** |

No outbound spend is planned from the grant. Review is open and public, through issues and pull requests in this
repo. There is no paid external audit.
