# Managed services

The suite is Apache-2.0 and free forever: every check, the CI action, the devnet runner and the Lean models. The
paid options below are services on top. There is no lock-in and no paid tier of checks.

| service | what you get | how it's priced |
|---|---|---|
| Continuous monitoring | Scheduled runs against your live endpoints (GET-only unless you permit devnet `/verify` and `/settle`), with alerts on regressions such as `settlement_pending` handling, duplicate credit or timeouts | monthly subscription |
| Signed conformance reports | A report for each release, signed and Proofline-verified, with a public verify link you can put next to your badge | per release |
| Custom checks | Your scheme, chain or extension written as checks, with Lean models where they help | fixed-scope work, quoted up front |
| Priority support | An agreed response time on issues you raise, and fixes to the suite that your integration needs | monthly, with monitoring or on its own |

**Design partners.** The first three customers get design-partner pricing in return for feedback and, if they
agree, a mention in the matrix.

**Payment.** USDC on Solana or Base, or through x402 itself. The receiving address is on the invoice or the checkout
page only, never in an issue or a pull request.

**Contact.** Open a [Managed services enquiry](https://github.com/atsp-protocol/x402-conformance/issues/new?template=managed-services.yml)
or email data@optitransfer.ch. Security reports go through SECURITY.md, not here.
