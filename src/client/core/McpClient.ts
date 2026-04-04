import { type McpModule, type ToolHandler } from '@/client/models/types';
import { McpConnection } from '@/client/utils/connection';
import { ModuleRunner } from '@/client/utils/moduleRunner';
import { type ToolRequest } from '@/shared/protocol';

const DEFAULT_PORT = 8347;

export class McpClient {
  private static instance: McpClient | null = null;

  private connection: McpConnection;
  private moduleRunner = new ModuleRunner();

  private constructor(port: number) {
    this.connection = new McpConnection(port);

    this.connection.onOpen(() => {
      this.sendRegistration();
    });

    this.connection.onMessage((message: ToolRequest) => {
      if (message.type === 'tool_request') {
        this.moduleRunner
          .handleRequest(message)
          .then((result) => {
            this.connection.send({
              id: message.id,
              result,
              type: 'tool_response',
            });
          })
          .catch((error: Error) => {
            this.connection.send({
              error: error.message,
              id: message.id,
              type: 'tool_response',
            });
          });
      }
    });

    this.connection.connect();
  }

  static initialize(port?: number): McpClient {
    if (McpClient.instance) {
      return McpClient.instance;
    }

    McpClient.instance = new McpClient(port ?? DEFAULT_PORT);
    return McpClient.instance;
  }

  static getInstance(): McpClient {
    if (!McpClient.instance) {
      console.error(
        '[react-native-mcp] McpClient is not initialized. Call McpClient.initialize() first.'
      );

      throw new Error('McpClient is not initialized. Call McpClient.initialize() first.');
    }

    return McpClient.instance;
  }

  dispose(): void {
    this.connection.dispose();
    McpClient.instance = null;
  }

  registerModule(module: McpModule): void {
    this.moduleRunner.registerModules([module]);
    this.sendRegistration();
  }

  registerModules(modules: McpModule[]): void {
    this.moduleRunner.registerModules(modules);
    this.sendRegistration();
  }

  registerTool(name: string, tool: ToolHandler): void {
    this.moduleRunner.registerDynamicTool(name, tool);
    this.connection.send({
      module: '_dynamic',
      tool: {
        description: tool.description,
        inputSchema: tool.inputSchema,
        name,
      },
      type: 'tool_register',
    });
  }

  removeState(key: string): void {
    this.connection.send({
      key,
      type: 'state_remove',
    });
  }

  setState(key: string, value: unknown): void {
    this.connection.send({
      key,
      type: 'state_update',
      value,
    });
  }

  unregisterTool(name: string): void {
    this.moduleRunner.unregisterDynamicTool(name);
    this.connection.send({
      module: '_dynamic',
      toolName: name,
      type: 'tool_unregister',
    });
  }

  private sendRegistration(): void {
    this.connection.send({
      modules: this.moduleRunner.getModuleDescriptors(),
      type: 'registration',
    });
  }
}
