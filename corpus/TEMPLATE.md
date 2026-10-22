# Corpus case template

An accepted case is one JSON file in `corpus/cases/`, named `<date>-<check ids>-<stack>.json`, for example
`2026-11-03-R3-hono.json`. It is the anonymised case the submitter shared (`x402-conformance.case/1`, see
[case.schema.json](case.schema.json)) plus a `regression` block that proves the suite catches it:

```json
{
 "schema": "x402-conformance.case/1",
 "tool_version": "1.4.0",
 "via": "cli-ts",
 "kind": "resource-server",
 "target": "redacted",
 "stack": { "framework": "hono", "sdk": "@x402/hono", "sdk_version": "2.28.0", "network": "eip155:84532" },
 "failed_ids": ["R3"],
 "results": [ "... as shared, unchanged ..." ],
 "regression": {
  "control": "ts:R3 control",
  "faulty": "ts:R3 catches serve_on_any_settle",
  "expect_failed": ["R3"],
  "issue": "https://github.com/atsp-protocol/x402-conformance/issues/<n>",
  "reproduced_on": "@x402/hono 2.28.0 with EXAMPLE_FAULT=serve_on_any_settle"
 }
}
```

## The regression block

| Field | What it holds |
|---|---|
| `control` | What passes: `reference` (the Python reference facilitator double), or `ts:<test name>` for a TypeScript test that runs the stock stack and passes. |
| `faulty` | What fails, one of: `fault:<name>` (a double in `src/x402conf/mock.py` FAULTS), `guard:<name>` (a guard in `harness.GUARD_FAULTS`), `answer:<file>` (a recorded 402 answer under `corpus/answers/`, with `status`, `headers` and `body`), or `ts:<test name>` (a TypeScript test against a faulty build). |
| `expect_failed` | The check IDs the faulty build must fail. A subset of `failed_ids`. |
| `issue` | The corpus-case issue it came from. |
| `reproduced_on` | The pinned version or the double it was reproduced against. |

`tests/test_offline.py` (`test_corpus_cases_are_complete_and_pass`) checks every file: the schema, that the check IDs
exist, that the control passes and that the faulty build still fails `expect_failed`. A case that stops reproducing
fails CI, which is the point.

## Before a case is accepted

1. It reproduces against a deliberately faulty double or a pinned version of the named stack.
2. It contains nothing identifying: no URLs, hosts, IPs, addresses or transaction data (the anonymiser removes them;
   read it again anyway).
3. If the failure could put someone's money at risk, it goes through private disclosure first (SECURITY.md), and the
   case is added only after the fix is public.
