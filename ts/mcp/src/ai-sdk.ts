// The agent-safe x402-conformance tools for the Vercel AI SDK (ai 5 and later):
//   import { x402ConformanceTools } from "x402-conformance-mcp/ai-sdk";
//   await generateText({ model, tools: x402ConformanceTools(), prompt: "Is https://api.example.com/paid a valid x402 route?" });
import { tool, type Tool } from "ai";
import { z } from "zod";
import { AGENT_TOOLS, type ToolDef } from "./tools.js";

export function x402ConformanceTools(defs: ToolDef<any>[] = AGENT_TOOLS): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  for (const t of defs) {
    out[t.name] = tool({
      description: t.description,
      inputSchema: z.object(t.input),
      execute: async (args: any) => (await t.run(args, "ai-sdk")).text,
    }) as Tool;
  }
  return out;
}
