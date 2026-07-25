import { type ZodType } from 'zod';

export interface ToolHandler {
  description: string;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
  inputSchema?: ZodType;
  /**
   * Callable over the bridge but kept out of the registration descriptor, so
   * it never reaches an agent's catalog. For plumbing a host tool needs inside
   * the app — `device.set_clipboard` backing `host__type_text` on Android —
   * where exposing a second tool would only invite calling it by hand.
   */
  internal?: boolean;
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
