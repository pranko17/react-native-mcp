/** Separator between module name and tool name in MCP call format */
export const MODULE_SEPARATOR = '__';

/** Prefix for dynamic tools registered via useMcpTool */
export const DYNAMIC_PREFIX = `${MODULE_SEPARATOR}dynamic${MODULE_SEPARATOR}`;

// === RN App → Server: при подключении регистрирует модули ===

export interface ModuleToolDescriptor {
  description: string;
  name: string;
  inputSchema?: Record<string, unknown>;
  timeout?: number;
}

export interface ModuleDescriptor {
  name: string;
  tools: ModuleToolDescriptor[];
  description?: string;
}

export interface RegistrationMessage {
  modules: ModuleDescriptor[];
  type: 'registration';
}

// === Server → RN App: вызов tool ===

export interface ToolRequest {
  args: Record<string, unknown>;
  id: string;
  method: string;
  module: string;
  type: 'tool_request';
}

// === RN App → Server: результат ===

export interface ToolResponse {
  id: string;
  type: 'tool_response';
  error?: string;
  result?: unknown;
}

// === RN App → Server: state updates (от useMcpState) ===

export interface StateUpdateMessage {
  key: string;
  type: 'state_update';
  value: unknown;
}

export interface StateRemoveMessage {
  key: string;
  type: 'state_remove';
}

// === RN App → Server: динамическая регистрация tool (от useMcpTool) ===

export interface ToolRegisterMessage {
  module: string;
  tool: ModuleToolDescriptor;
  type: 'tool_register';
}

export interface ToolUnregisterMessage {
  module: string;
  toolName: string;
  type: 'tool_unregister';
}

// === Union types ===

export type ClientMessage =
  | RegistrationMessage
  | StateRemoveMessage
  | StateUpdateMessage
  | ToolRegisterMessage
  | ToolResponse
  | ToolUnregisterMessage;

export type ServerMessage = ToolRequest;
