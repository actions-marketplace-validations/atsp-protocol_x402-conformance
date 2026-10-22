# The x402 failure corpus

Every failure the suite has found in a real stack and someone chose to share. Each case is an anonymised
`x402-conformance.case/1` file: the check IDs, the status of every check, the shape of the failing answer, the tool
version, the entry point it came through (`via`) and the stack its submitter named. No URLs, hosts, IPs, addresses or
transaction data.

## How a case gets here

1. A run fails, in any entry point: the CLIs, the Action, the vitest or jest matchers, pytest, the MCP server, the
   agent tools or the Docker image. They all write the same report (`x402-conformance.report/1`, schema in
   [report.schema.json](report.schema.json)).
2. Its owner opts in: `--share` on the CLIs, `saveReport(report, { share: true })` in tests, or the MCP tool
   `x402_share_case`. That writes the anonymised case ([case.schema.json](case.schema.json)) and prints a link to the
   pre-filled [corpus case form](https://github.com/atsp-protocol/x402-conformance/issues/new?template=corpus-case.yml).
   Nothing is ever sent automatically.
3. I reproduce it. A case is accepted once it reproduces against a deliberately faulty double or a pinned version of the
   named stack, and it's committed in `cases/` as `<date>-<check ids>-<stack>.json` with a regression block that
   proves the suite catches it. The format is in [TEMPLATE.md](TEMPLATE.md).

## Why it matters

A check is only as good as the failures it has caught. The corpus is the record of failures real x402 stacks have shown,
and every accepted case becomes a test that every later run of the suite carries.

## Cases

None accepted yet.
