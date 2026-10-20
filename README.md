# x402 Conformance

**Prove your x402 payments can't double-credit, credit too early or credit on a broken answer, in one CI step.**

[![ci](https://github.com/atsp-protocol/x402-conformance/actions/workflows/ci.yml/badge.svg)](https://github.com/atsp-protocol/x402-conformance/actions/workflows/ci.yml)
[![Tested with x402-conformance](https://img.shields.io/badge/tested%20with-x402--conformance-2ea44f)](https://github.com/atsp-protocol/x402-conformance)
[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-x402%20Conformance-blue?logo=github)](https://github.com/marketplace/actions/x402-conformance)

**Experimental.** I built this as an open set of conformance and safety checks for [x402](https://github.com/coinbase/x402)
V2 facilitators and resource servers, starting with Solana. It complements x402 and its facilitators and doesn't
replace them. It checks the properties a seller's money depends on, and it never signs, pays or touches mainnet.
— Ryan Gillespie, Optitransfer

## 30-second quickstart

**GitHub Action** ([on the Marketplace](https://github.com/marketplace/actions/x402-conformance)). Add one step to any workflow:

```yaml
- uses: atsp-protocol/x402-conformance@v1
  with:
    facilitators: https://your-facilitator.example   # GET /supported only
```

With no inputs it runs the F1-F9 safety suite. Add `facilitators` to check your live `/supported`, or point it at
your resource server:

```yaml
- uses: atsp-protocol/x402-conformance@v1
  with:
    resource-url: http://127.0.0.1:4020/paid
    start: node server.js            # your server reads X402_FACILITATOR_URL
```

Every run writes a job summary and sets the `result` output to `pass` or `fail`.

**CLI.** Python 3.10 or later, no dependencies:

```
pip install "git+https://github.com/atsp-protocol/x402-conformance@v1"
x402conf live https://x402.org/facilitator     # S1-S4, GET /supported only
x402conf offline                               # F1-F9 against the reference and fault-injected doubles
```

## What it catches

**Live, read-only (`GET /supported`):**
- **S1** the response is missing `kinds`, `extensions` or `signers`
- **S2** a V2 network isn't written as a CAIP-2 ID
- **S3** a Solana kind uses an old V1 name such as `solana-devnet` instead of the published ID
- **S4** a Solana `exact` kind has no valid fee payer, or one that isn't a listed signer

**Safety, against doubles, on devnet and in your resource server:**
- **F1** a malformed payment is accepted instead of rejected
- **F2** an underpayment or dust amount is accepted
- **F3** the same payment is settled, or served, twice
- **F4** a used memo or nonce is replayed in a new transaction
- **F5** a payment counts as settled before it's confirmed, or `settlement_pending` comes without a transaction
- **F6** a facilitator timeout or garbage answer turns into a credit
- **F7** a pending payment retried with the same body never reaches its final result, or is credited more than once
- **F8** a payment that failed on chain stays "pending" instead of failing
- **F9** a 503, an HTML page or a truncated `/settle` answer is credited, or the payment can't be retried afterwards

The resource-server checks (R0-R9, in `ts/`) put a facilitator double in front of your server and request your paid
route under each of these faults. [docs/SPEC.md](docs/SPEC.md) quotes the spec text behind every check. Passing a check is evidence
about one property. It doesn't certify conformance to x402.

## Add the badge

If your project runs the suite in CI, add this to your README:

```markdown
[![Tested with x402-conformance](https://img.shields.io/badge/tested%20with-x402--conformance-2ea44f)](https://github.com/atsp-protocol/x402-conformance)
```

## Who uses it

No public users yet: this is a new project, and I only list a user once they've said so publicly. If you run it,
open an issue and I'll add you here and to [docs/ADOPTION.md](docs/ADOPTION.md).

**Free run for your project.** Open an issue with your repo or facilitator URL and I'll run the suite against it,
post the results, and send a tests-only pull request with the Action and badge. It's free, with no conditions.

## Results (2026-10-20, live, `GET /supported` only)
| facilitator | HTTP | S1 | S2 | S3 | S4 | Solana kinds advertised |
|---|---|---|---|---|---|---|
| x402.dexter.cash | 200 | pass | pass | pass | pass | exact (mainnet, devnet), tab, bridge |
| facilitator.payai.network | 200 | pass | pass | pass | pass | exact and batch-settlement (mainnet, devnet) |
| x402.org/facilitator | 200 | pass | pass | pass | pass | exact (devnet) |

Raw bodies, `run.json` and `SHA256SUMS` are in [evidence/2026-10-20](evidence/2026-10-20). Devnet results for F1 to
F6 go in the [facilitator matrix](docs/MATRIX.md), and I run them against a third party only with the operator's
permission.

## What's inside
- `src/x402conf`: the live checks, the offline suite and the devnet runner (`x402conf devnet`), which runs F1-F6 over
  real `/verify` and `/settle` against a self-hosted reference facilitator on Solana devnet, with throwaway keys.
- `ts/`: the TypeScript runner for resource servers built on `@x402/core` and `@x402/svm`.
- `action.yml`: the GitHub Action.
- `lean/`: Lean 4 models of the credit rule, nonces, timeouts, `settlement_pending` reconciliation and concurrent
  settles. They use only standard axioms and contain no `sorry`. They model the rule the suite checks, not any
  facilitator's code.
- `proofline.json`: the signed scope contract. `tools/vv.py` checks every acceptance criterion in CI ([docs/VV.md](docs/VV.md)).

## Free and open core
Apache-2.0. Every check, the Action, the devnet runner and the Lean models are free, forever. Contributions and new
check proposals are welcome ([CONTRIBUTING.md](CONTRIBUTING.md)).

## Managed services
If you'd rather not run it yourself, or you need more than the open suite, I offer:
- **Hosted continuous monitoring** of your live endpoints, with alerts on regressions
- **Signed conformance reports** for each release, with a public verify link
- **Custom checks** for your scheme, chain or extensions
- **Priority support** with an agreed response time

The first three customers get design-partner pricing. Details are in [docs/MANAGED.md](docs/MANAGED.md). To get in touch, open a
[Managed services enquiry](https://github.com/atsp-protocol/x402-conformance/issues/new?template=managed-services.yml)
or email data@optitransfer.ch.

**How I charge.** The core is free. Monitoring is a monthly subscription, reports are priced per release, and custom
checks are fixed-scope work quoted up front. I take payment in USDC on Solana or Base, or through x402 itself.

## Safety
The suite holds no keys of yours and never signs or pays. Live mode is GET-only, and that's tested. The devnet
runner refuses mainnet and any third-party facilitator without written permission. To report a vulnerability, see
[SECURITY.md](SECURITY.md).

## Licence
Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) (Ryan Gillespie / Optitransfer).
