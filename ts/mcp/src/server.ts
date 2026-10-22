// x402-conformance-mcp: the suite as MCP tools over stdio, for Claude, Cursor, VS Code and any MCP client.
//   { "mcpServers": { "x402-conformance": { "command": "npx", "args": ["-y", "x402-conformance-mcp"] } } }
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ALL_TOOLS, shutdown, type ToolDef } from "./tools.js";

export const VERSION: string = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

export function createServer(tools: ToolDef<any>[] = ALL_TOOLS): McpServer {
  const server = new McpServer({ name: "x402-conformance", version: VERSION }, {
    instructions: "x402 conformance and safety checks. x402_check_payment_required checks any paid URL's 402 answer " +
      "with one unpaid GET. To test a resource server you run: x402_start_facilitator_double, start your server with " +
      "that facilitator URL, x402_probe_resource_server, then x402_stop_facilitator_double. x402_demo shows a full run " +
      "with no setup. x402_explain_check explains a failure; x402_share_case prepares an anonymised corpus case the " +
      "user can choose to submit. Nothing pays, signs or touches mainnet.",
  });
  for (const t of tools) {
    server.registerTool(t.name, {
      title: t.title, description: t.description, inputSchema: t.input,
      annotations: { readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: t.name === "x402_check_payment_required" },
    }, async (args: any) => {
      try {
        const r = await t.run(args, "mcp");
        return { content: [{ type: "text" as const, text: r.text }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] };
      }
    });
  }
  return server;
}
