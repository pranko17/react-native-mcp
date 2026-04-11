import { Bridge } from './bridge';
import { McpServerWrapper } from './mcpServer';
import { type ServerConfig } from './types';

const DEFAULT_PORT = 8347;

export async function createServer(config?: ServerConfig): Promise<void> {
  const port = config?.port ?? DEFAULT_PORT;
  const bridge = new Bridge(port);
  const mcpServer = new McpServerWrapper(bridge);

  await bridge.start();
  process.stderr.write(`react-native-mcp-kit bridge listening on port ${port}\n`);

  await mcpServer.start();
}

export { type ServerConfig } from './types';
