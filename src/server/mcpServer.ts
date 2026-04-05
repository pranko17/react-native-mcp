import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { DYNAMIC_PREFIX, MODULE_SEPARATOR, type ModuleDescriptor } from '@/shared/protocol';

import { type Bridge } from './bridge';

const BASE_INSTRUCTIONS = `You are connected to a running React Native app via the react-native-mcp bridge.

## How to interact

1. Use \`connection_status\` to check if the app is connected
2. Use \`list_tools\` to see all available tools with descriptions and examples
3. Use \`call\` to invoke any tool with format: module${MODULE_SEPARATOR}method (e.g. navigation${MODULE_SEPARATOR}navigate)
4. Use \`state_list\` / \`state_get\` to read app state exposed by the developer
`;

export class McpServerWrapper {
  private dynamicTools = new Map<string, { description: string; module: string }>();
  private mcp: McpServer;
  private modules: ModuleDescriptor[] = [];
  private stateStore = new Map<string, unknown>();

  constructor(private readonly bridge: Bridge) {
    this.mcp = new McpServer(
      { name: 'react-native-mcp', version: '1.0.0' },
      { instructions: BASE_INSTRUCTIONS }
    );

    this.registerTools();
  }

  addDynamicTool(module: string, name: string, description: string): void {
    this.dynamicTools.set(`${module}${MODULE_SEPARATOR}${name}`, { description, module });
  }

  removeDynamicTool(module: string, name: string): void {
    this.dynamicTools.delete(`${module}${MODULE_SEPARATOR}${name}`);
  }

  setModules(modules: ModuleDescriptor[]): void {
    this.modules = modules;
  }

  setState(key: string, value: unknown): void {
    this.stateStore.set(key, value);
  }

  removeState(key: string): void {
    this.stateStore.delete(key);
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
  }

  private registerTools(): void {
    this.mcp.registerTool(
      'call',
      {
        annotations: {
          openWorldHint: true,
          title: 'Call Tool',
        },
        description:
          'Call a tool registered by the React Native app. Use list_tools first to see available tools.',
        inputSchema: {
          args: z
            .string()
            .optional()
            .describe('Arguments as JSON string (e.g. {"screen": "AUTH_LOGIN_SCREEN"})'),
          tool: z
            .string()
            .describe(
              `Tool name in format "module${MODULE_SEPARATOR}method" (e.g. "navigation${MODULE_SEPARATOR}navigate")`
            ),
        },
      },
      async ({ args, tool }) => {
        if (!this.bridge.isClientConnected()) {
          return {
            content: [
              {
                text: JSON.stringify({ error: 'React Native app is not connected' }),
                type: 'text' as const,
              },
            ],
          };
        }

        // Find the module by matching prefix
        let mod: (typeof this.modules)[0] | undefined;
        let moduleName = '';
        let methodName = '';

        for (const m of this.modules) {
          const prefix = `${m.name}${MODULE_SEPARATOR}`;
          if (tool.startsWith(prefix)) {
            mod = m;
            moduleName = m.name;
            methodName = tool.slice(prefix.length);
            break;
          }
        }

        // If no module matched, check for dynamic tool prefix
        if (!mod) {
          if (tool.startsWith(DYNAMIC_PREFIX)) {
            moduleName = `${MODULE_SEPARATOR}dynamic`;
            methodName = tool.slice(DYNAMIC_PREFIX.length);
          } else {
            const idx = tool.indexOf(MODULE_SEPARATOR);
            if (idx <= 0) {
              return {
                content: [
                  {
                    text: JSON.stringify({
                      error: `Invalid tool name "${tool}". Use "module${MODULE_SEPARATOR}method" format.`,
                    }),
                    type: 'text' as const,
                  },
                ],
              };
            }
            moduleName = tool.slice(0, idx);
            methodName = tool.slice(idx + MODULE_SEPARATOR.length);
          }
        }
        let parsedArgs: Record<string, unknown> = {};
        if (args) {
          try {
            parsedArgs = JSON.parse(args) as Record<string, unknown>;
          } catch {
            return {
              content: [
                { text: JSON.stringify({ error: 'Invalid JSON in args' }), type: 'text' as const },
              ],
            };
          }
        }

        if (!mod) {
          // No module matched — try as dynamic tool via bridge
          try {
            const result = await this.bridge.call(moduleName, methodName, parsedArgs);
            return { content: this.formatResult(result) };
          } catch {
            const allModules = this.modules
              .map((m) => {
                return m.name;
              })
              .join(', ');
            const dynNames = [...this.dynamicTools.keys()].join(', ');
            return {
              content: [
                {
                  text: JSON.stringify({
                    error: `Tool "${tool}" not found. Modules: ${allModules}. Dynamic: ${dynNames || 'none'}`,
                  }),
                  type: 'text' as const,
                },
              ],
            };
          }
        }

        const toolDef = mod.tools.find((t) => {
          return t.name === methodName;
        });
        if (!toolDef) {
          return {
            content: [
              {
                text: JSON.stringify({
                  error: `Tool "${methodName}" not found in module "${moduleName}". Available: ${mod.tools
                    .map((t) => {
                      return t.name;
                    })
                    .join(', ')}`,
                }),
                type: 'text' as const,
              },
            ],
          };
        }

        const result = await this.bridge.call(moduleName, methodName, parsedArgs, toolDef.timeout);
        return { content: this.formatResult(result) };
      }
    );

    this.mcp.registerTool(
      'list_tools',
      {
        annotations: {
          readOnlyHint: true,
          title: 'List Tools',
        },
        description: 'List all tools registered by the React Native app, grouped by module',
      },
      async () => {
        if (!this.bridge.isClientConnected()) {
          return {
            content: [
              {
                text: JSON.stringify({
                  connected: false,
                  error: 'React Native app is not connected',
                }),
                type: 'text' as const,
              },
            ],
          };
        }

        const moduleTools = this.modules.map((mod) => {
          return {
            description: mod.description,
            module: mod.name,
            tools: mod.tools.map((t) => {
              return {
                description: t.description,
                inputSchema: t.inputSchema,
                name: `${mod.name}${MODULE_SEPARATOR}${t.name}`,
              };
            }),
          };
        });

        // Add dynamic tools (from useMcpTool hooks)
        if (this.dynamicTools.size > 0) {
          const dynamicByModule = new Map<
            string,
            Array<{ description: string; name: string; inputSchema?: Record<string, unknown> }>
          >();
          for (const [fullName, info] of this.dynamicTools) {
            const existing = dynamicByModule.get(info.module) ?? [];
            existing.push({
              description: info.description,
              inputSchema: undefined,
              name: fullName,
            });
            dynamicByModule.set(info.module, existing);
          }
          for (const [module, dynTools] of dynamicByModule) {
            moduleTools.push({
              description: 'Dynamically registered tools from useMcpTool hooks',
              module: `${module} (dynamic)`,
              tools: dynTools as (typeof moduleTools)[0]['tools'],
            });
          }
        }

        return {
          content: [{ text: JSON.stringify(moduleTools, null, 2), type: 'text' as const }],
        };
      }
    );

    this.mcp.registerTool(
      'connection_status',
      {
        annotations: {
          readOnlyHint: true,
          title: 'Connection Status',
        },
        description: 'Check if the React Native app is connected',
      },
      async () => {
        return {
          content: [
            {
              text: JSON.stringify({
                connected: this.bridge.isClientConnected(),
                modules: this.modules.map((m) => {
                  return m.name;
                }),
              }),
              type: 'text' as const,
            },
          ],
        };
      }
    );

    this.mcp.registerTool(
      'state_get',
      {
        annotations: {
          readOnlyHint: true,
          title: 'Get State',
        },
        description: 'Read a state value exposed by the React Native app via useMcpState',
        inputSchema: {
          key: z.string().describe('State key to read (e.g. "cart", "auth")'),
        },
      },
      async ({ key }) => {
        const value = this.stateStore.get(key);
        if (value === undefined) {
          return {
            content: [
              {
                text: JSON.stringify({
                  error: `State "${key}" not found. Use state_list to see available keys.`,
                }),
                type: 'text' as const,
              },
            ],
          };
        }
        return {
          content: [{ text: JSON.stringify(value, null, 2), type: 'text' as const }],
        };
      }
    );

    this.mcp.registerTool(
      'state_list',
      {
        annotations: {
          readOnlyHint: true,
          title: 'List State',
        },
        description: 'List all available state keys exposed by the React Native app',
      },
      async () => {
        const keys = Array.from(this.stateStore.keys());
        return {
          content: [{ text: JSON.stringify({ keys }, null, 2), type: 'text' as const }],
        };
      }
    );
  }

  private formatResult(result: unknown) {
    if (Array.isArray(result) && result.length > 0) {
      const first = result[0];
      if (
        typeof first === 'object' &&
        first !== null &&
        'type' in first &&
        first.type === 'image'
      ) {
        return result as Array<{ data: string; mimeType: string; type: 'image' }>;
      }
    }

    return [{ text: JSON.stringify(result, null, 2), type: 'text' as const }];
  }
}
