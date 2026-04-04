import { type ReactNode } from 'react';

import { type ToolHandler } from '@/client/models/types';

export interface McpContextValue {
  registerTool: (name: string, tool: ToolHandler) => void;
  removeState: (key: string) => void;
  setState: (key: string, value: unknown) => void;
  unregisterTool: (name: string) => void;
}

export interface McpProviderProps {
  children: ReactNode;
}
