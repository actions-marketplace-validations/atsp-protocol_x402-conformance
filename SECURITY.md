# Security policy

## Reporting a vulnerability
Please use GitHub private vulnerability reporting: **Security → Report a vulnerability**
(https://github.com/atsp-protocol/x402-conformance/security/advisories/new). Do not open a public issue for a
vulnerability, and please do not report one by email.

I acknowledge reports within 7 days. Supported version: the latest `main` and the latest tag.

## Findings about third-party facilitators
When this suite finds a failing safety check in someone else's facilitator, I report it to that operator
privately first. I publish only after a fix, or 90 days after the report, whichever comes first. The suite never
probes a third party beyond `GET /supported` without that operator's permission.

## What the suite will not do
It holds no keys, signs nothing, and makes no payments. Live mode is GET-only, and that is tested.
