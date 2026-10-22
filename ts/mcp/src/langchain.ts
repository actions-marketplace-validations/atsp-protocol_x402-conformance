// The agent-safe x402-conformance tools for LangChain.js and LangGraph:
//   import { x402ConformanceTools } from "x402-conformance-mcp/langchain";
//   const agent = createReactAgent({ llm, tools: x402ConformanceTools() });
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { AGENT_TOOLS, type ToolDef } from "./tools.js";

export function x402ConformanceTools(defs: ToolDef<any>[] = AGENT_TOOLS): StructuredToolInterface[] {
  return defs.map((t) => tool(async (args: any) => (await t.run(args, "langchain")).text,
    { name: t.name, description: t.description, schema: z.object(t.input) }) as unknown as StructuredToolInterface);
}
