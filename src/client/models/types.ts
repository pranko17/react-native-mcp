import { type ZodType } from 'zod';

export interface ToolHandler {
  description: string;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
  inputSchema?: ZodType;
  timeout?: number;
}

// No module-level `description`: MCP has no notion of a module — `tools/list`
// is flat, so anything written at this level reaches no agent. Document a
// module in its folder's CLAUDE.md, and put what an agent needs into the
// individual tool / argument descriptions or the server instructions.
export interface McpModule {
  name: string;
  tools: Record<string, ToolHandler>;
}
