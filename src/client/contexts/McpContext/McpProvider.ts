import { createElement, useMemo } from 'react';

import { McpClient } from '@/client/core/McpClient';

import { McpContext } from './McpContext';
import { type McpContextValue, type McpProviderProps } from './types';

export const McpProvider = ({ children }: McpProviderProps) => {
  const contextValue = useMemo<McpContextValue>(() => {
    const client = McpClient.getInstance();
    return {
      registerTool: (name, tool) => {
        client.registerTool(name, tool);
      },
      removeState: (key) => {
        client.removeState(key);
      },
      setState: (key, value) => {
        client.setState(key, value);
      },
      unregisterTool: (name) => {
        client.unregisterTool(name);
      },
    };
  }, []);

  return createElement(McpContext.Provider, { value: contextValue }, children);
};
