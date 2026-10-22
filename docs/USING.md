# Using x402-conformance from your stack

One suite, one set of check IDs, one report format, one corpus. Every entry point below is a thin way into the same
checks: a result from the CLI, the Action, vitest, jest or node:test means the same thing and has the same shape
([report schema](../evidence/corpus/report.schema.json)). None of them pays, signs or touches mainnet, and none of
them sends anything anywhere unless you ask it to.

- **What the checks are:** [README](../README.md#what-it-catches), with the spec text behind each in [SPEC.md](SPEC.md).
- **What to do when one fails:** [FIXES.md](FIXES.md). Every failure message links to its section.
- **The corpus:** [evidence/corpus](../evidence/corpus). Failures real stacks have shown, each one a regression case.
- **Contribute a case:** add `--share` (or `share: true`). You get an anonymised case file and a link to a pre-filled
  [issue form](https://github.com/atsp-protocol/x402-conformance/issues/new?template=corpus-case.yml). You review it and
  submit it yourself; nothing is sent for you.
- **Badge**, once you pass:
  `[![Tested with x402-conformance](https://img.shields.io/badge/tested%20with-x402--conformance-2ea44f)](https://github.com/atsp-protocol/x402-conformance)`

Every entry point names itself in the report's `via` field and in the User-Agent of the requests it makes
(`x402-conformance/<version> (+https://github.com/atsp-protocol/x402-conformance; via=<entry point>)`). That's the only
identifier: no machine or user ID, and no telemetry. It lets shared cases and committed reports be counted per
ecosystem.

| entry point | `via` | install |
|---|---|---|
| [Command line](#command-line) | `cli-py`, `cli-ts` | `pipx run --spec x402-conformance x402conf`, `npx -y x402-conformance-svm` |
| [GitHub Actions](#github-actions) | `action` | `uses: atsp-protocol/x402-conformance@v1` |
| [vitest](#vitest) | `vitest` | `npm i -D x402-conformance-svm` |
| [jest](#jest) | `jest` | `npm i -D x402-conformance-svm` |
| [node:test and other runners](#nodetest-and-other-runners) | `node-test` | `npm i -D x402-conformance-svm` |
| [Hono, Express and other servers](#hono-express-and-other-servers) | any of the above | |

## Command line

```
x402conf resource https://your.api/paid                              # P1-P5, one unpaid GET (Python)
npx -y x402-conformance-svm resource --url https://your.api/paid      # the same P1-P5, in Node
npx -y x402-conformance-svm probe --resource http://127.0.0.1:4020/paid --start "node server.js" --share
```

The Node `resource` command is a port of the Python one with the same check IDs; CI runs both on 29 answers and
fails if they ever disagree. `--share` on a failing run writes `<out>.case.json` and prints the issue link.

## GitHub Actions

See [the README](../README.md#github-action). The Action writes the same reports, plus SARIF for code scanning and
JUnit for test summaries.

## vitest

```ts
// x402.spec.ts
import { expect, test } from "vitest";
import { checkPaymentRequired, runConformance, x402Matchers, type X402Matchers } from "x402-conformance-svm/testing";
import { startMyServer } from "./server.js"; // takes a facilitator URL, returns { url, close }

declare module "vitest" { interface Assertion<T = any> extends X402Matchers<T> {} }
expect.extend(x402Matchers);

test("my paid route never serves before settlement", async () => {
  const report = await runConformance({ via: "vitest", start: (facilitatorUrl) => startMyServer(facilitatorUrl) });
  expect(report).toPassX402Conformance();
}, 120_000);
```

`runConformance` starts the facilitator double on loopback, calls your factory with its URL, runs R0-R10 against the
route it returns and closes everything. Your factory must use that URL as the server's facilitator and offer Solana
devnet or Base Sepolia on the route. A failure prints each failed check, its detail, its fix link, and how to share
it. [ts/vitest/x402.spec.ts](../ts/vitest/x402.spec.ts) is this quickstart, run in CI against stock `@x402/hono`.

To check only the unpaid answer: `expect(await checkPaymentRequired(url)).toBeValidX402Challenge()`.

## jest

The matchers follow the `expect.extend` contract vitest and jest share, so the vitest code works unchanged with
`import { expect, test } from "@jest/globals"` and `via: "jest"`. CI runs them in vitest and node:test, not jest.

## node:test and other runners

```ts
import { test } from "node:test";
import { assertX402Conformance, runConformance, saveReport } from "x402-conformance-svm/testing";

test("x402", async () => {
  const report = await runConformance({ via: "node-test", start: (f) => startMyServer(f) });
  saveReport(report);                 // ./x402-conformance/*.json, or X402CONF_REPORT_DIR
  assertX402Conformance(report);      // throws with the same message the matchers print
});
```

`saveReport(report, { share: true, stack: { framework: "hono", sdk: "@x402/hono", sdk_version: "2.28.0" } })` also
writes the anonymised case and returns the issue link.

## Hono, Express and other servers

Any server works if its facilitator URL comes from configuration. CI runs the stock `@x402/hono`
([example](../ts/example/hono-server.ts)) and `@x402/express` ([example](../ts/example/express-server.ts)) middleware
through `runConformance` on Solana devnet and Base Sepolia, and both pass. For a server you can't start in-process,
use the CLI's `--start` or the Action.
