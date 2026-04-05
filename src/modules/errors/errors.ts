import { type McpModule } from '@/client/models/types';

import { type ErrorEntry, type ErrorSource, type ErrorsModuleOptions } from './types';

const DEFAULT_MAX_ENTRIES = 50;

export const errorsModule = (options?: ErrorsModuleOptions): McpModule => {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const buffer: ErrorEntry[] = [];

  const addEntry = (entry: ErrorEntry) => {
    // Deduplicate by message + timestamp proximity (within 100ms)
    const lastEntry = buffer[buffer.length - 1];
    if (lastEntry && lastEntry.message === entry.message) {
      const timeDiff =
        new Date(entry.timestamp).getTime() - new Date(lastEntry.timestamp).getTime();
      if (Math.abs(timeDiff) < 100) return;
    }

    buffer.push(entry);
    if (buffer.length > maxEntries) {
      buffer.splice(0, buffer.length - maxEntries);
    }
  };

  // 1. Intercept ErrorUtils global handler (catches fatal JS errors)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ErrorUtilsGlobal = (global as any).ErrorUtils;
  if (ErrorUtilsGlobal) {
    const originalHandler = ErrorUtilsGlobal.getGlobalHandler();
    ErrorUtilsGlobal.setGlobalHandler((error: Error, isFatal: boolean) => {
      const source: ErrorSource = error.message?.includes('in promise') ? 'promise' : 'global';
      addEntry({
        isFatal,
        message: error.message,
        source,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
      if (originalHandler) {
        originalHandler(error, isFatal);
      }
    });
  }

  // 2. Intercept console.error to catch promise rejections reported by RN
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const firstArg = args[0];

    // RN reports unhandled promise rejections as console.error with an Error object
    if (firstArg && typeof firstArg === 'object' && 'message' in firstArg) {
      const error = firstArg as { message?: string; name?: string; stack?: string };
      if (error.message?.includes('in promise')) {
        addEntry({
          isFatal: false,
          message: error.message,
          source: 'promise',
          stack: error.stack,
          timestamp: new Date().toISOString(),
        });
      }
    }

    originalConsoleError.apply(console, args);
  };

  return {
    description: 'Captured unhandled JS errors and promise rejections with stack traces.',
    name: 'errors',
    tools: {
      clear_errors: {
        description: 'Clear all captured errors from the buffer',
        handler: () => {
          buffer.length = 0;
          return { success: true };
        },
      },
      get_errors: {
        description: 'Get all captured unhandled errors and promise rejections',
        handler: (args) => {
          let result = [...buffer];
          if (args.source) {
            result = result.filter((e) => {
              return e.source === (args.source as string);
            });
          }
          if (typeof args.fatal === 'boolean') {
            result = result.filter((e) => {
              return e.isFatal === args.fatal;
            });
          }
          if (args.limit) {
            result = result.slice(-(args.limit as number));
          }
          return result;
        },
        inputSchema: {
          fatal: { description: 'Filter by fatal flag (true/false)', type: 'boolean' },
          limit: { description: 'Max number of entries to return', type: 'number' },
          source: { description: 'Filter by source (global, promise)', type: 'string' },
        },
      },
      get_fatal: {
        description: 'Get only fatal errors',
        handler: (args) => {
          let result = buffer.filter((e) => {
            return e.isFatal;
          });
          if (args.limit) {
            result = result.slice(-(args.limit as number));
          }
          return result;
        },
        inputSchema: {
          limit: { description: 'Max number of entries to return', type: 'number' },
        },
      },
      get_stats: {
        description: 'Get error statistics (total, by source, fatal count)',
        handler: () => {
          return {
            bySource: {
              global: buffer.filter((e) => {
                return e.source === 'global';
              }).length,
              promise: buffer.filter((e) => {
                return e.source === 'promise';
              }).length,
            },
            fatal: buffer.filter((e) => {
              return e.isFatal;
            }).length,
            total: buffer.length,
          };
        },
      },
    },
  };
};
