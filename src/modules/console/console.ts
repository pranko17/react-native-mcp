import { type McpModule } from '@/client/models/types';
import { applySlice, parseSliceArg, sliceSchemaDescription } from '@/shared/slice';

import { type ConsoleModuleOptions, type LogEntry, type LogLevel } from './types';

const ALL_LEVELS: LogLevel[] = ['debug', 'error', 'info', 'log', 'warn'];
const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_STACK_LEVELS: LogLevel[] = ['error', 'warn'];

const serializeArg = (arg: unknown, seen = new WeakSet<object>()): unknown => {
  if (arg === null || arg === undefined) return arg;

  if (typeof arg === 'function') {
    return `[Function: ${arg.name || 'anonymous'}]`;
  }

  if (typeof arg === 'symbol') {
    return arg.toString();
  }

  if (typeof arg !== 'object') return arg;

  if (arg instanceof Error) {
    return {
      message: arg.message,
      name: arg.name,
      stack: arg.stack,
    };
  }

  if (arg instanceof Date) {
    return arg.toISOString();
  }

  if (arg instanceof RegExp) {
    return arg.toString();
  }

  if (seen.has(arg)) {
    return '[Circular]';
  }
  seen.add(arg);

  if (Array.isArray(arg)) {
    return arg.map((item) => {
      return serializeArg(item, seen);
    });
  }

  const className = arg.constructor?.name;
  const serialized: Record<string, unknown> = {};

  if (className && className !== 'Object') {
    serialized.__class = className;
  }

  for (const key of Object.keys(arg)) {
    serialized[key] = serializeArg((arg as Record<string, unknown>)[key], seen);
  }

  return serialized;
};

const captureStack = (): string | undefined => {
  const stack = new Error().stack;
  if (!stack) return undefined;
  const lines = stack.split('\n');
  // Remove Error, captureStack, addEntry, console[level] wrapper frames
  return lines.slice(4).join('\n');
};

// === Module-level capture state — auto-starts at import time. ===
//
// Rationale: when `McpProvider` mounts, its `useEffect` runs after React's
// first render — any console.log fired during bundle evaluation or the first
// render would be lost. Patching at module import time (before React boots)
// closes that gap. The factory below adopts the pre-existing buffer and
// applies caller-supplied options retroactively.

const buffer: LogEntry[] = [];
let maxEntries = DEFAULT_MAX_ENTRIES;
let capturedLevels = new Set<LogLevel>(ALL_LEVELS);
let stackLevels = new Set<LogLevel>(DEFAULT_STACK_LEVELS);

const addEntry = (level: LogLevel, args: unknown[]): void => {
  if (!capturedLevels.has(level)) return;
  const entry: LogEntry = {
    args: args.map((arg) => {
      return serializeArg(arg);
    }),
    level,
    timestamp: new Date().toISOString(),
  };
  if (stackLevels.has(level)) {
    entry.stack = captureStack();
  }
  buffer.push(entry);
  if (buffer.length > maxEntries) {
    buffer.splice(0, buffer.length - maxEntries);
  }
};

let patchesInstalled = false;
const installPatches = (): void => {
  if (patchesInstalled) return;
  patchesInstalled = true;
  for (const level of ALL_LEVELS) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      addEntry(level, args);
      original.apply(console, args);
    };
  }
};

installPatches();

export const consoleModule = (options?: ConsoleModuleOptions): McpModule => {
  // Apply options retroactively to the already-running buffer.
  if (typeof options?.maxEntries === 'number') {
    maxEntries = options.maxEntries;
    if (buffer.length > maxEntries) {
      buffer.splice(0, buffer.length - maxEntries);
    }
  }
  if (options?.levels) {
    capturedLevels = new Set(options.levels);
  }
  if (options?.stackTrace === true) {
    stackLevels = new Set(ALL_LEVELS);
  } else if (options?.stackTrace === false) {
    stackLevels = new Set();
  } else if (Array.isArray(options?.stackTrace)) {
    stackLevels = new Set(options.stackTrace);
  }

  const filterByLevel = (level: LogLevel, slice: unknown): LogEntry[] => {
    const filtered = buffer.filter((entry) => {
      return entry.level === level;
    });
    return applySlice(filtered, parseSliceArg(slice));
  };

  const sliceSchema = {
    description: sliceSchemaDescription('Default omitted → every matching entry is returned.'),
    examples: [[-10], [-20, -10], [0, 50]],
    type: 'array',
  };

  return {
    description: `Ring buffer of console.log/warn/error/info/debug.

Complex values (Errors, Dates, class instances, cyclic refs, functions,
Symbols) are serialized safely. Stack traces can be captured per level.
Capture starts at module-import time (before React mounts) so cold-start
logs are not lost. Buffer size and captured levels are configurable via
consoleModule options.`,
    name: 'console',
    tools: {
      clear_logs: {
        description: 'Clear the log buffer.',
        handler: () => {
          buffer.length = 0;
          return { success: true };
        },
      },
      get_debug: {
        description: 'Return console.debug entries.',
        handler: (args) => {
          return filterByLevel('debug', args.slice);
        },
        inputSchema: {
          slice: sliceSchema,
        },
      },
      get_errors: {
        description: 'Return console.error entries.',
        handler: (args) => {
          return filterByLevel('error', args.slice);
        },
        inputSchema: {
          slice: sliceSchema,
        },
      },
      get_info: {
        description: 'Return console.info entries.',
        handler: (args) => {
          return filterByLevel('info', args.slice);
        },
        inputSchema: {
          slice: sliceSchema,
        },
      },
      get_logs: {
        description: 'Return all log entries, optionally filtered by level and slice.',
        handler: (args) => {
          let result = [...buffer];
          if (args.level) {
            result = result.filter((entry) => {
              return entry.level === (args.level as LogLevel);
            });
          }
          return applySlice(result, parseSliceArg(args.slice));
        },
        inputSchema: {
          level: {
            description: 'Filter by level.',
            examples: ['log', 'warn', 'error', 'info', 'debug'],
            type: 'string',
          },
          slice: sliceSchema,
        },
      },
      get_warnings: {
        description: 'Return console.warn entries.',
        handler: (args) => {
          return filterByLevel('warn', args.slice);
        },
        inputSchema: {
          slice: sliceSchema,
        },
      },
    },
  };
};
