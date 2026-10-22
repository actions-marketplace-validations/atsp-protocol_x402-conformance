#!/usr/bin/env node
// The x402-conformance-mcp command: the MCP server on stdio.
import { createServer, VERSION } from "./server.js";
import { shutdown } from "./tools.js";

const arg = process.argv[2];
if (arg === "--version" || arg === "-V") {
  console.log(VERSION);
} else if (arg === "--help" || arg === "-h") {
  console.log(`x402-conformance-mcp ${VERSION}: x402 conformance checks as MCP tools (stdio).\n` +
    `Add to your MCP client: { "command": "npx", "args": ["-y", "x402-conformance-mcp"] }\n` +
    "Docs: https://github.com/atsp-protocol/x402-conformance/blob/main/docs/USING.md");
} else {
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const server = createServer();
  const stop = async () => { await shutdown(); await server.close(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.stdin.on("end", stop);
  await server.connect(new StdioServerTransport());
}
