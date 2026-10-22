# x402-conformance-mcp

x402 conformance and safety checks as tools, for MCP clients (Claude, Cursor, VS Code, Windsurf and others), the Vercel
AI SDK and LangChain. It's a thin entry point into the open
[x402-conformance](https://github.com/atsp-protocol/x402-conformance) suite: the same checks, check IDs and report as
the CLI, the GitHub Action and the test matchers. It never pays, signs or touches mainnet.

<!-- mcp-name: io.github.atsp-protocol/x402-conformance -->

## MCP

```json
{ "mcpServers": { "x402-conformance": { "command": "npx", "args": ["-y", "x402-conformance-mcp"] } } }
```

| tool | what it does |
|---|---|
| `x402_check_payment_required` | one unpaid GET to a paid URL; checks its 402 answer (P1-P5) |
| `x402_demo` | the whole suite against a built-in demo server, no wallet or setup; `fault: serve_on_any_settle` shows a failure |
| `x402_start_facilitator_double` | starts the facilitator double on loopback; point your server at its URL |
| `x402_probe_resource_server` | R0-R10 against your server on loopback: no content on a timeout, a broken answer, `settlement_pending`, a failure or a duplicate |
| `x402_stop_facilitator_double` | stops the double |
| `x402_explain_check` | what a check tests and how to fix a failure |
| `x402_share_case` | an anonymised corpus case and a pre-filled issue link; nothing is sent, the user decides |

Try asking: "Run the x402 demo", "Check the 402 answer at http://127.0.0.1:4020/paid", or "Start the facilitator
double, I'll point my server at it, then probe http://127.0.0.1:4020/paid".

## Vercel AI SDK

```ts
import { generateText } from "ai";
import { x402ConformanceTools } from "x402-conformance-mcp/ai-sdk";

await generateText({ model, tools: x402ConformanceTools(), prompt: "Is the 402 answer at https://api.example.com/paid valid x402?" });
```

## LangChain and LangGraph

```ts
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { x402ConformanceTools } from "x402-conformance-mcp/langchain";

const agent = createReactAgent({ llm, tools: x402ConformanceTools() });
```

The AI SDK and LangChain adapters give an agent the four read-only tools (check, demo, explain, share). The double and
probe tools stay in MCP, where a person is driving.

## The corpus

A failing report can become an anonymised case in the public
[corpus of real x402 failures](https://github.com/atsp-protocol/x402-conformance/tree/main/evidence/corpus).
`x402_share_case` prepares it and returns the link; the user reviews it and submits it, or doesn't. Every report names
the entry point that produced it (`via: mcp`, `ai-sdk` or `langchain`) in the report and the User-Agent; there's no
other identifier and no telemetry.

Apache-2.0. Ryan Gillespie, Optitransfer.
