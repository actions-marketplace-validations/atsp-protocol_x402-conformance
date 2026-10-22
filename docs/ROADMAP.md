# Roadmap

**Where it stands.** v1.3.1 is the current release, and it is still marked experimental. S0 to S4 check a
facilitator's `GET /supported`, P1 to P5 check any paid URL's 402 answer with one unpaid GET, F1 to F10 run against
fault-injected facilitator doubles (and F1 to F6 over real `/verify` and `/settle` on Solana devnet), R0 to R10 put a
misbehaving facilitator in front of your own paid route on Solana devnet or Base Sepolia, and the Lean models cover the
credit rule, nonces, timeouts, `settlement_pending` and concurrent settles. There are no public users yet.

**Where it's going.** Having many checks is not the same as covering the security boundary that matters. The question
a seller actually needs answered is: *does this payment authorise this request, is what was bought actually
delivered, and does my stack recover safely when the payment and the HTTP exchange disagree?* The next two releases
are about answering that with evidence, in three adversarial test families, in this order:

1. **Payment-to-request binding** (v1.4): a payment for one route, price, recipient or method never unlocks another.
2. **Concurrency and idempotency** (v1.5): one payment is one grant, across parallel requests, several replicas and a
   crash between settling and serving.
3. **Payment versus delivery** (v1.5): a settled payment never ends in nothing delivered, and a failed delivery never
   ends in a settled payment, with an explicit outcome for timeouts, `HEAD`, redirects, errors and caches.

Everything on this page is my proposal. It's open for review in issues and Discussions, and dates are targets, not
promises.

## How I decide what goes in

A check is added only when it meets all of these. This is the quality bar, and it applies to every item below.

- **A spec basis or a named failure class.** Either it quotes the x402 text it rests on, or it names a reproduced,
  public failure class and says plainly that the spec is silent.
- **A legitimate control that passes.** A stock, correctly configured implementation (the reference facilitator, a
  stock `@x402/express` server and so on) runs green.
- **A deliberately faulty implementation that it catches.** Each check ships with at least one faulty build that
  reproduces the failure, and CI proves the check fails against it. A check that can't fail isn't a check.
- **Reproducible evidence.** Pinned versions, lockfile hashes, the raw exchange and a hash of the results, so anyone
  can rerun it and get the same answer.
- **No financial risk.** Loopback doubles, local chains and testnets only. The suite never signs a real payment,
  never pays and never touches mainnet.

### Three profiles, reported separately

From v1.4, every check carries one of three classifications, and results, SARIF and the job summary report them
separately. Passing one profile says nothing about the others.

| profile | what it means | example |
|---|---|---|
| **normative** | The x402 spec, a transport spec or an extension spec says MUST or REQUIRED, and the check quotes it | `/verify` must not commit payment state (V2 §7.1) |
| **security profile** | The spec is silent or permissive, but a public, reproduced failure shows that a seller loses money or a buyer pays for nothing | a paid route must not be reachable through an encoded path separator |
| **resilience** | Interoperability and recovery under real-world limits and faults | a `PAYMENT-REQUIRED` header small enough for common HTTP clients to read |

A security-profile or resilience failure is not a spec violation, and the report says so.

## v1.4: binding and a trustworthy oracle (target: November 2026)

### P0. The suite's own oracle fails closed

The reference verifier in `mock.py` parses amounts with Python's `int()`. On malformed input it raises
(`ValueError`, `TypeError`, `OverflowError`) instead of returning a rejection, and it is lenient where x402 is not:
it accepts surrounding whitespace, non-ASCII digits, booleans and floats (truncated), and it does not reject a
negative or zero price in the requirements. An oracle that crashes or accepts what a strict verifier would refuse makes
every check that depends on it weaker.

- **Change:** one strict atomic-unit parser (`^(0|[1-9][0-9]{0,77})$` as a JSON string, fitting uint256) used by every
  double, the harness and the TypeScript probe; any other input is a clean `invalid_payload` or
  `invalid_payment_requirements`, never an exception. A requirement amount must be positive.
- **Spec basis:** V2 §5.1.2, `amount` is a string in atomic token units.
- **Control:** every existing vector still passes. **Faulty build:** a `lenient_amounts` double using `int()`.
- **Test:** a table of malformed amounts (`"abc"`, `null`, `"1e6"`, `" 10 "`, full-width digits, `true`, `1.5`,
  `"-5"`, a 79-digit number) on both the payload and the requirements: the reference returns a rejection for every
  one, and the faulty double is caught.
- **Profile:** normative.

### P0. R11: a payment for one route never unlocks another (real routes, end to end)

F10 proves cross-request replay is refused at the facilitator boundary, but only on the in-process double, and the
resource substitution it tests is not what happens on the wire: F10 adds a `resource` field to `PaymentRequirements`,
and V2 `PaymentRequirements` has no such field. In V2 the resource travels separately, as `PaymentPayload.resource`,
which is optional and set by the client (§5.2.2), so a facilitator can't bind a payment to a route at all. The binding
has to happen in the resource server, and that's where it needs to be tested.

R11 runs against a real resource server with **two routes at different prices**, behind the facilitator double, and
grades each substitution separately. The double accepts any well-formed payment, so every rejection it sees has to come
from the server's own matching.

| sub-check | the attempt | must happen | profile |
|---|---|---|---|
| R11a | a payment built for the cheap route's `accepts` presented on the expensive route | 402, and no `/settle` | normative (V2 §5.2.2: `accepted` is the requirements chosen; the server matches it against its own) |
| R11b | the payment's recipient (`payTo`), asset or network altered | 402 before any `/settle` | normative (V2 §5.1.2, §9 recipient and amount mismatch codes) |
| R11c | a payment for `GET` presented with another method on a route priced differently by method | 402, and no `/settle` | security profile |
| R11d | the same path with a different query string, on a route priced by query or by dynamic price | priced for the request actually made | security profile |
| R11e | an unpaid request to a parameterised paid route with an encoded separator or dot segment (`%2F`, `%5C`, `%2e%2e`, double encoding) | 402, not content | security profile: the payment middleware and the web framework must agree on the path. Public reports show this mismatch in more than one x402 implementation |
| R11f | with the sign-in-with-x extension: pay the cheap route while `PaymentPayload.resource.url` names the expensive one, then present only a SIWX header on the expensive route | 402: the access record belongs to the route that was priced and settled | security profile, SIWX spec ("has previously paid for the requested resource"). Upstream: [x402#3838](https://github.com/x402-foundation/x402/issues/3838), open, fix proposed in [x402#3840](https://github.com/x402-foundation/x402/pull/3840) |
| control | a correct payment on each route | served once, with `PAYMENT-RESPONSE` | – |

- **Faulty builds** (in `ts/example/faulty/`): a server that prices from the client's `resource.url`; one that matches
  routes on the decoded path while the framework routes on the raw one; one that records SIWX access under the
  payload's URL. Each is caught by the sub-check it targets, and the stock `@x402/express` server passes.
- **F10 is narrowed** to what a facilitator can actually enforce (amount, asset, recipient and network in the
  requirements set a transaction was verified under), and its docs say resource binding is R11's job.
- **R11f's expectation** is pinned to the upstream outcome. If upstream settles on a different rule, R11f follows the
  spec and the change is recorded in the changelog.

### P1. Cheap normative checks the spec already supports

| check | what | spec basis | faulty build | where |
|---|---|---|---|---|
| F11 | a `settlement_pending` answer carries a non-empty `transaction` and `network` | V2 §9: "MUST carry a non-empty `transaction` … and `network`" | a double that returns pending with no hash | offline, devnet, and the probe's double |
| F12 | `/verify` is read-only: verifying twice, then settling, still settles once, and verify alone consumes nothing | V2 §7.1: `/verify` "MUST NOT commit payment state" | a double whose verify burns the nonce | offline, devnet |
| P6 | the encoded `PAYMENT-REQUIRED` header fits common client limits: warning above 8 KB, error above 16 KB | resilience: the spec sets no budget. Upstream [x402#3803](https://github.com/x402-foundation/x402/issues/3803), open: Node's fetch fails above 16 KB of headers and aiohttp above about 8 KB | a fixture with a large discovery extension | `resource`, read-only |
| P7 | a 402 whose resolved payment flow isn't `authorization` declares `extra.paymentFlow` | V2 §6.1: it "MUST be present" | a fixture that omits it | `resource`, read-only |

### P1. Evidence and test credibility

- **Every result carries** its profile, spec basis, upstream reference, the faulty builds that check is known to
  catch, the versions under test and a lockfile hash. `report` adds the profile to SARIF and the JUnit names.
- **A credibility gate in CI:** a test fails the build if any check has no passing control or no faulty build it
  catches. The mutation matrix (check × faulty build) is published on the project page.
- **False positives:** each one gets a public issue, a fix or a documented exception, and a regression test.
- **README and SPEC.md** list F10 to F12, P6, P7 and R11 with the profile of each.

**v1.4 is done when** R11a to R11f catch their faulty builds and the stock server passes on Solana devnet and Base
Sepolia, the oracle survives the malformed-amount table, F11, F12, P6 and P7 ship with controls and faulty builds, and
the credibility gate is green.

## v1.5: concurrency, delivery and an implementation matrix (target: December 2026)

### P0. One payment, one grant

R2 today presents the same payment twice, one after the other. Real failures happen in parallel and across
processes: a public study ([Five Attacks on x402](https://arxiv.org/abs/2605.11781)) reports one payment reused for
hundreds of grants where the server did not record the payment identity atomically before releasing the resource.

| check | the attempt | must happen | profile |
|---|---|---|---|
| R12 | the same payment sent as N parallel requests (N = 2, 8, 32) to one server | at most one 2xx; at most one successful `/settle` | security profile |
| R13 | the same payment sent in parallel to two replicas behind a loopback round-robin, with and without a shared store | at most one grant across replicas; a server that needs a shared store says so in its result | security profile; the `payment-identifier` extension is the spec's idempotency key, and the SVM duplicate-settlement mitigation describes the same race for facilitators |
| R14 | the server is killed after `/settle` succeeds and before the response is written, restarted, and the payment presented again | no second settlement, no second charge, and a defined outcome: delivered once via an idempotency record, or refused with the transaction surfaced for reconciliation | resilience |

- **Faulty builds:** a per-process in-memory cache (fails R13), a check-then-set without atomicity (fails R12 under
  parallel load), and a server that settles again after a restart (fails R14).
- **Lean:** extend the settlement model to n replicas, and prove that a shared atomic check-and-set admits at most one
  grant while partitioned caches admit more. As with today's models, this proves the rule, not anyone's code.

### P1. Payment versus delivery

V2 §6.1 says that in the default `authorization` flow "funds move only after it completes successfully". That makes
most of this family normative.

| check | the attempt | must happen | profile |
|---|---|---|---|
| R15 | the paid handler fails (5xx), redirects (3xx) or throws | no `/settle`; nothing is charged | normative (V2 §6.1) |
| R16 | `HEAD` on a paid `GET` route, carrying a payment | not settled: a 402 telling the client to retry as `GET`, and zero `/settle` calls | security profile (RFC 9110 §9.3.2: a `HEAD` response carries no content). Upstream [x402#3810](https://github.com/x402-foundation/x402/issues/3810), open, fix proposed in [x402#3813](https://github.com/x402-foundation/x402/pull/3813) |
| R17 | a paid response, then an unpaid request for the same URL through a loopback caching proxy | the unpaid request gets 402; paid responses are marked `Cache-Control: private, no-store` or vary on the payment header | security profile ([Five Attacks on x402](https://arxiv.org/abs/2605.11781), cache leakage) |
| R18 | `settlement_pending`, then success on the retry; pending until the deadline; success after the server timed out | the outcome is explicit and reconcilable: served once after the payment is final, or refused with the transaction hash surfaced, never served twice | resilience. The Base timeout race in [x402#1062](https://github.com/x402-foundation/x402/issues/1062) is closed upstream through `settlement_pending` and one automatic settle retry; R8 already covers "not served while pending", and R18 covers the recovery path |
| R19 | for routes using an `upfront` or `escrow` flow | the resource never executes before a check has run, and an unsupported flow is rejected | normative (V2 §6.1: "at least one check … MUST run before the resource executes"; servers "MUST reject unsupported" combinations) |

### P1. Implementation matrix

The probe speaks HTTP, so it can grade any stack. v1.5 runs it in CI against the stock example servers I can build
and pin: TypeScript (`@x402/express`, `@x402/hono`, `@x402/next`), Python (FastAPI, Flask) and Go (gin), at pinned SDK
versions, on Solana devnet and Base Sepolia. The matrix is published in [MATRIX.md](MATRIX.md) with one row per stack and
version. A failing row on a stock server becomes a coordinated report to the maintainers first, under
[SECURITY.md](../SECURITY.md), and a public row only once it's fixed or the disclosure window has passed. A server
that can't start (for example, a Go server registering a scheme for `eip155:*`, upstream
[x402#3861](https://github.com/x402-foundation/x402/issues/3861)) is reported as a setup failure with the reason, not
as a pass or a security failure.

**v1.5 is done when** R12 to R19 catch their faulty builds, the stock TypeScript server passes them, and the matrix has
at least five stack-and-version rows with pinned, hashed evidence.

## Later: breadth, once the depth is there

Each of these lands only when it can be tested as thoroughly as `exact` is today.

- **The MCP transport** (`specs/transports-v2/mcp.md`): a read-only check of a paid tool's payment-required answer,
  then fault injection on paid tool calls. The upstream Python MCP tests are not run by CI today
  ([x402#3793](https://github.com/x402-foundation/x402/issues/3793)), so independent coverage here is useful.
- **Settlement preemption** for caller-unbound settlement (Permit2 on EVM), from the same study.
- **The `upto` and `batch-settlement` schemes**, then A2A and discovery (Bazaar) checks.
- **SIWX normative checks**: domain and `uri` origin from the server's configuration, never from `Host`; nonce
  uniqueness; `issuedAt` and expiry windows.

## The release gate

v1.4 and v1.5 ship as soon as their own criteria pass, still marked experimental. The experimental label comes off,
and I describe the suite as a dependable x402 safety gate, only when all six of these hold:

- [ ] **Resource binding.** A real protected route rejects resource, amount, recipient and method substitution (R11).
- [ ] **Concurrency.** Parallel replay and multi-replica tests can't double-grant single-use access (R12, R13).
- [ ] **Delivery recovery.** Timeout, late settlement, failed response, redirect, `HEAD` and retry scenarios have
  explicit, tested outcomes (R14 to R18).
- [ ] **Test credibility.** Every check catches at least one faulty build and passes a legitimate control, and CI
  enforces it.
- [ ] **Safe, reproducible evidence.** Pinned versions, clear scope, raw results, hashes and documented
  false-positive handling.
- [ ] **Public validation.** At least three independent teams have run it and published results or actionable issues.

Before that point the test definitions are frozen for one release, run against independent implementations, and the
evidence is published.

## What stays free, and what doesn't

**Free and open source, Apache-2.0, permanently:** every check and its spec mapping, the faulty builds, the facilitator
double, the CLI, the GitHub Action, the evidence format, the Lean models, the implementation matrix and every result I
publish. No check will ever move behind a paywall, and the free core will always be enough to gate your own CI.

**Paid, later, for teams that would rather not run it themselves** ([MANAGED.md](MANAGED.md)): hosted continuous
monitoring of live endpoints (read-only), signed per-release reports with a public verify link, custom checks for
a scheme, chain or extension, and priority support. Anything a paid engagement produces that is a general check comes
back into the free core.

**Not on the roadmap:**
- **Certification.** A pass is evidence about one property on one day. The badge says "tested with", and I won't
  offer a certification scheme without agreed criteria and independent governance.
- **A hosted dashboard**, until developers are regularly running the free suite.
- **Shallow checks** added to raise the count. Each check has to meet the bar above.
- **Mainnet probes** or anything else that submits a real payment or creates financial risk.
- **Every chain, SDK and extension at once.** Depth on payment-to-resource safety comes first.

## How I'll measure it

| measure | v1.4 | v1.5 | release gate |
|---|---|---|---|
| checks with a passing control and a caught faulty build | 100% | 100% | 100% |
| stack-and-version rows in the matrix | 2 | 5 | 8 |
| external repos running the Action in CI (public) | 1 | 3 | 5 |
| independent teams with published runs or issues | – | 1 | 3 |
| upstream issues reproduced by a check, with a fix validated | 2 | 4 | 6 |
| median time from a false-positive report to a fix or a documented exception | 7 days | 7 days | 7 days |
| time from `pipx run` to a first result | under 60 s | under 60 s | under 60 s |

I count a user or a team only when they've said so publicly.

## Programme milestones

These were my original proposal for taking the suite from a working tool to a standard people rely on. Every milestone
is a Proofline task in `proofline.json` (XC-M1 to XC-M6), with acceptance criteria that CI verifies. The v1.4 and v1.5
work above is proposed as new contract tasks in [proposals/contract-addendum-v1.4-v1.5.json](proposals/contract-addendum-v1.4-v1.5.json);
it becomes binding only once I sign it into `proofline.json`.

| id | deliverable | acceptance (summary) | status |
|---|---|---|---|
| M1 | **Devnet runner.** F1 to F6 run over real x402 V2 `/verify` and `/settle` against a facilitator on Solana devnet that I host myself, using throwaway devnet keypairs | `x402conf devnet` exits 0 against the self-hosted reference facilitator; each F check also fails against a fault-injected build; the devnet evidence is committed with hashes | devnet run done (1.1.0), [evidence/devnet](../evidence/devnet): F1, F2, F3, F5 and F6 pass, every fault-injected build is caught, and F4 fails on the reference facilitator (memo not tracked across transactions), so the exit-0 criterion is not met yet |
| M2 | **Facilitator matrix.** Results pages for at least 3 facilitators that offer Solana devnet, run only with each operator's permission | `evidence/matrix/` holds at least 3 facilitator reports; any failures go through the 90-day disclosure in [SECURITY.md](../SECURITY.md) first | open: waiting on operator permission |
| M3 | **Lean models extended.** Timeouts, `settlement_pending` reconciliation, and concurrent settles over a shared cache | New theorems build in CI with only standard axioms; each theorem is linked to its F check in [SPEC.md](SPEC.md) | done (1.0.0) |
| M4 | **Drop-in CI action.** A GitHub Action plus a TypeScript runner for resource servers built on `@x402/svm` (and, since 1.3.0, `@x402/evm`) | The action runs F1 to F6 in another repo's CI, and an example repo is green | done (1.0.0) |
| M5 | **Maintenance for 6 months.** Issues, spec updates and fixes | Monthly: open issues are triaged within 7 days and CI stays green on the current spec | ongoing since 1.0.0 |
| M6 | **Adoption.** Real projects relying on it | At least 3 external repos run the suite in CI; at least 5 facilitators have published results | open: needs real users |

Review is open and public, through issues, pull requests and Discussions in this repo.

— Ryan Gillespie, Optitransfer
