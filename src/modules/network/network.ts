import { type McpModule } from '@/client/models/types';

import { type CapturedBody, type NetworkEntry, type NetworkModuleOptions } from './types';

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_BODY_MAX_BYTES = 20_000;
const DEFAULT_BODY_PREVIEW = 200;
const DEFAULT_IGNORE_URLS = [/^ws:/, /^wss:/, /localhost:8081/, /symbolicate/];

const DEFAULT_REDACT_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
];
const DEFAULT_REDACT_BODY_KEYS = [
  'accessToken',
  'apiKey',
  'otp',
  'password',
  'pin',
  'refreshToken',
  'secret',
  'token',
];

const shouldIgnore = (url: string, patterns: Array<string | RegExp>): boolean => {
  return patterns.some((pattern) => {
    if (typeof pattern === 'string') return url.includes(pattern);
    return pattern.test(url);
  });
};

const parseHeaders = (
  headers: Headers | Record<string, string> | undefined
): Record<string, string> => {
  if (!headers) return {};
  if (typeof headers.forEach === 'function') {
    const result: Record<string, string> = {};
    (headers as Headers).forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  return headers as Record<string, string>;
};

const redactHeadersMap = (
  headers: Record<string, string>,
  redact: Set<string> | null
): Record<string, string> => {
  if (!redact || redact.size === 0) return headers;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = redact.has(key.toLowerCase()) ? '[redacted]' : value;
  }
  return out;
};

// Walk an object graph replacing values for any key (case-insensitive) in
// `redact`. Preserves shape so the agent still sees the field exists.
const redactBodyValue = (value: unknown, redact: Set<string> | null): unknown => {
  if (!redact || redact.size === 0) return value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      return redactBodyValue(item, redact);
    });
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redact.has(key.toLowerCase()) ? '[redacted]' : redactBodyValue(v, redact);
  }
  return out;
};

const tryParseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const byteLengthOf = (value: unknown): number => {
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
};

// Capture a request/response body under `bodyMaxBytes`. Returns undefined when
// the payload should not be captured at all (disabled, null, binary).
const captureBody = (
  raw: unknown,
  bodyMaxBytes: number,
  redactKeys: Set<string> | null
): CapturedBody | undefined => {
  if (raw === null || raw === undefined) return undefined;
  if (bodyMaxBytes <= 0) return undefined;

  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    parsed = tryParseJson(raw);
  }

  const redacted = redactBodyValue(parsed, redactKeys);
  const bytes = byteLengthOf(redacted);

  if (bytes > bodyMaxBytes) {
    const preview =
      typeof redacted === 'string'
        ? redacted.slice(0, DEFAULT_BODY_PREVIEW)
        : JSON.stringify(redacted).slice(0, DEFAULT_BODY_PREVIEW);
    return { bytes, preview, truncated: true };
  }
  return { bytes, data: redacted };
};

const toRedactSet = (
  list: string[] | false | undefined,
  defaults: string[]
): Set<string> | null => {
  if (list === false) return null;
  const src = list === undefined ? defaults : list;
  return new Set(
    src.map((s) => {
      return s.toLowerCase();
    })
  );
};

/**
 * Strip full-body `data` from an entry, keeping just size + preview. Agents
 * get a lean overview from get_requests/get_errors by default and can reach
 * for `get_body` when they need the payload.
 */
const withoutBody = (entry: NetworkEntry): NetworkEntry => {
  const req = entry.request.body ? { ...entry.request.body, data: undefined } : undefined;
  const res = entry.response?.body ? { ...entry.response.body, data: undefined } : undefined;
  return {
    ...entry,
    request: { ...entry.request, body: req },
    response: entry.response
      ? {
          ...entry.response,
          body: res,
        }
      : null,
  };
};

const percentile = (sorted: number[], p: number): number | null => {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
};

export const networkModule = (options?: NetworkModuleOptions): McpModule => {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const includeBodies = options?.includeBodies ?? true;
  const bodyMaxBytes = includeBodies ? (options?.bodyMaxBytes ?? DEFAULT_BODY_MAX_BYTES) : 0;
  const ignoreUrls = [...DEFAULT_IGNORE_URLS, ...(options?.ignoreUrls ?? [])];
  const redactHeaderSet = toRedactSet(options?.redactHeaders, DEFAULT_REDACT_HEADERS);
  const redactBodyKeySet = toRedactSet(options?.redactBodyKeys, DEFAULT_REDACT_BODY_KEYS);
  const buffer: NetworkEntry[] = [];
  let nextId = 1;

  const addEntry = (base: Omit<NetworkEntry, 'id'>): NetworkEntry => {
    const entry: NetworkEntry = { ...base, id: nextId++ };
    buffer.push(entry);
    if (buffer.length > maxEntries) {
      buffer.splice(0, buffer.length - maxEntries);
    }
    return entry;
  };

  // Intercept global fetch
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = async (input: any, init?: any): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';

    if (shouldIgnore(url, ignoreUrls)) {
      return originalFetch(input, init);
    }

    const entry = addEntry({
      duration: null,
      method: method.toUpperCase(),
      request: {
        body: captureBody(init?.body, bodyMaxBytes, redactBodyKeySet),
        headers: redactHeadersMap(
          parseHeaders(init?.headers as Record<string, string>),
          redactHeaderSet
        ),
      },
      response: null,
      startedAt: new Date().toISOString(),
      status: 'pending',
      url,
    });

    const startTime = Date.now();

    try {
      const response = await originalFetch(input, init);
      entry.duration = Date.now() - startTime;
      entry.status = 'success';

      let responseBody: CapturedBody | undefined;
      if (bodyMaxBytes > 0) {
        try {
          const cloned = response.clone();
          const text = await cloned.text();
          responseBody = captureBody(text, bodyMaxBytes, redactBodyKeySet);
        } catch {
          responseBody = undefined;
        }
      }

      entry.response = {
        body: responseBody,
        headers: redactHeadersMap(parseHeaders(response.headers), redactHeaderSet),
        status: response.status,
      };

      return response;
    } catch (error) {
      entry.duration = Date.now() - startTime;
      entry.status = 'error';
      entry.response = {
        body: { bytes: 0, data: error instanceof Error ? error.message : String(error) },
        headers: {},
        status: 0,
      };
      throw error;
    }
  };

  // Intercept XMLHttpRequest
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XHR = (global as any).XMLHttpRequest;
  const originalOpen = XHR.prototype.open;
  const originalSend = XHR.prototype.send;
  const originalSetRequestHeader = XHR.prototype.setRequestHeader;

  XHR.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
    const urlStr = typeof url === 'string' ? url : url.toString();
    (this as unknown as Record<string, unknown>).__mcp_method = method;
    (this as unknown as Record<string, unknown>).__mcp_url = urlStr;
    (this as unknown as Record<string, unknown>).__mcp_headers = {};
    return originalOpen.apply(this, [method, url, ...rest] as unknown as Parameters<
      typeof originalOpen
    >);
  };

  XHR.prototype.setRequestHeader = function (name: string, value: string) {
    const headers = (this as unknown as Record<string, unknown>).__mcp_headers as Record<
      string,
      string
    >;
    if (headers) headers[name] = value;
    return originalSetRequestHeader.call(this, name, value);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XHR.prototype.send = function (body?: any) {
    const url = (this as unknown as Record<string, unknown>).__mcp_url as string;
    const method = (this as unknown as Record<string, unknown>).__mcp_method as string;
    const headers = (this as unknown as Record<string, unknown>).__mcp_headers as Record<
      string,
      string
    >;

    if (!url || shouldIgnore(url, ignoreUrls)) {
      return originalSend.call(this, body);
    }

    const entry = addEntry({
      duration: null,
      method: (method ?? 'GET').toUpperCase(),
      request: {
        body: captureBody(body, bodyMaxBytes, redactBodyKeySet),
        headers: redactHeadersMap(headers ?? {}, redactHeaderSet),
      },
      response: null,
      startedAt: new Date().toISOString(),
      status: 'pending',
      url,
    });

    const startTime = Date.now();

    this.addEventListener('loadend', () => {
      entry.duration = Date.now() - startTime;
      entry.status = this.status >= 200 && this.status < 400 ? 'success' : 'error';

      let responseBody: CapturedBody | undefined;
      if (bodyMaxBytes > 0) {
        const responseType = this.responseType;
        if (responseType === '' || responseType === 'text') {
          try {
            responseBody = captureBody(this.responseText, bodyMaxBytes, redactBodyKeySet);
          } catch {
            responseBody = undefined;
          }
        } else if (responseType === 'json') {
          responseBody = captureBody(this.response, bodyMaxBytes, redactBodyKeySet);
        } else {
          // blob | arraybuffer | document — don't serialize binary / DOM payloads
          responseBody = { bytes: 0, preview: `[${responseType}]` };
        }
      }

      entry.response = {
        body: responseBody,
        headers: redactHeadersMap(
          parseHeaders(
            this.getAllResponseHeaders?.()
              ?.split('\r\n')
              .filter(Boolean)
              .reduce((acc: Record<string, string>, line: string) => {
                const [key, ...rest] = line.split(': ');
                if (key) acc[key] = rest.join(': ');
                return acc;
              }, {})
          ),
          redactHeaderSet
        ),
        status: this.status,
      };
    });

    return originalSend.call(this, body);
  };

  // Tool response shaping — strip full body unless explicitly requested.
  const project = (entries: NetworkEntry[], full: boolean): NetworkEntry[] => {
    if (full) return entries;
    return entries.map(withoutBody);
  };

  const findById = (id: number): NetworkEntry | undefined => {
    return buffer.find((e) => {
      return e.id === id;
    });
  };

  return {
    description: `Intercepted fetch + XMLHttpRequest — method, URL, status, duration, headers, bodies.

CAPTURE
  Each entry carries a numeric \`id\`. Bodies are stored up to bodyMaxBytes
  (default 20KB); larger payloads keep only a preview + truncated marker.
  Sensitive headers (Authorization, Cookie, Set-Cookie, X-Api-Key, X-Auth-*)
  and body keys (password, token, accessToken, refreshToken, apiKey, secret,
  otp, pin) are redacted at capture time.

QUERY
  get_requests / get_errors / get_request drop full \`data\` from each body
  by default — pass includeBodies: true to get them inline. Use get_body to
  fetch one specific body without polluting the response with the rest.

WebSocket / Metro / symbolicate traffic is auto-ignored. Buffer size, body
cap, and redaction lists are configurable via networkModule options.`,
    name: 'network',
    tools: {
      clear_requests: {
        description: 'Clear the request buffer.',
        handler: () => {
          buffer.length = 0;
          return { success: true };
        },
      },
      get_body: {
        description:
          'Fetch one captured request or response body by entry id (from get_requests). Returns { id, kind, body } or { error }. body.data is the parsed payload when the original size was below bodyMaxBytes; otherwise only preview + truncated are set.',
        handler: (args) => {
          const id = args.id as number;
          const kind = (args.kind as string) ?? 'response';
          if (typeof id !== 'number') return { error: 'id required (number).' };
          const entry = findById(id);
          if (!entry) return { error: `No entry with id ${id} (buffer has ${buffer.length}).` };
          if (kind !== 'request' && kind !== 'response') {
            return { error: `kind must be "request" or "response", got ${kind}.` };
          }
          const body = kind === 'request' ? entry.request.body : entry.response?.body;
          return { body: body ?? null, id, kind };
        },
        inputSchema: {
          id: { description: 'Entry id from get_requests.', type: 'number' },
          kind: {
            description: 'Which body to return: "request" or "response". Default "response".',
            examples: ['request', 'response'],
            type: 'string',
          },
        },
      },
      get_errors: {
        description:
          'Failed requests only (non-2xx or network errors). Bodies stripped by default; pass includeBodies: true to keep them.',
        handler: (args) => {
          let result = buffer.filter((e) => {
            return e.status === 'error';
          });
          if (args.limit) result = result.slice(-(args.limit as number));
          return project(result, args.includeBodies === true);
        },
        inputSchema: {
          includeBodies: {
            description: 'Include full body data in each entry. Default false.',
            type: 'boolean',
          },
          limit: { description: 'Max entries to return.', type: 'number' },
        },
      },
      get_pending: {
        description: 'In-flight requests (bodies stripped by default).',
        handler: (args) => {
          const result = buffer.filter((e) => {
            return e.status === 'pending';
          });
          return project(result, args.includeBodies === true);
        },
        inputSchema: {
          includeBodies: {
            description: 'Include full body data. Default false.',
            type: 'boolean',
          },
        },
      },
      get_request: {
        description: 'Requests whose URL contains the given substring. Bodies stripped by default.',
        handler: (args) => {
          const urlFilter = args.url as string;
          const result = buffer.filter((e) => {
            return e.url.includes(urlFilter);
          });
          return project(result, args.includeBodies === true);
        },
        inputSchema: {
          includeBodies: {
            description: 'Include full body data. Default false.',
            type: 'boolean',
          },
          url: { description: 'URL substring.', type: 'string' },
        },
      },
      get_requests: {
        description:
          'All captured requests; filterable by method / status / URL substring. Bodies stripped by default.',
        handler: (args) => {
          let result = [...buffer];
          if (args.method) {
            const method = (args.method as string).toUpperCase();
            result = result.filter((e) => {
              return e.method === method;
            });
          }
          if (args.status) {
            result = result.filter((e) => {
              return e.status === (args.status as string);
            });
          }
          if (args.url) {
            const urlFilter = args.url as string;
            result = result.filter((e) => {
              return e.url.includes(urlFilter);
            });
          }
          if (args.limit) result = result.slice(-(args.limit as number));
          return project(result, args.includeBodies === true);
        },
        inputSchema: {
          includeBodies: {
            description: 'Include full body data in each entry. Default false.',
            type: 'boolean',
          },
          limit: { description: 'Max entries to return.', type: 'number' },
          method: {
            description: 'HTTP method filter.',
            examples: ['GET', 'POST', 'PUT', 'DELETE'],
            type: 'string',
          },
          status: {
            description: 'Status filter.',
            examples: ['pending', 'success', 'error'],
            type: 'string',
          },
          url: { description: 'URL substring filter.', type: 'string' },
        },
      },
      get_stats: {
        description:
          'Counts — total, by status, by method — plus duration percentiles (min / p50 / p95 / max) and total bytes stored.',
        handler: () => {
          const byMethod: Record<string, number> = {};
          const byStatus: Record<string, number> = { error: 0, pending: 0, success: 0 };
          let bytes = 0;
          const durations: number[] = [];

          for (const entry of buffer) {
            byMethod[entry.method] = (byMethod[entry.method] ?? 0) + 1;
            byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
            if (typeof entry.duration === 'number') durations.push(entry.duration);
            bytes += entry.request.body?.bytes ?? 0;
            bytes += entry.response?.body?.bytes ?? 0;
          }

          durations.sort((a, b) => {
            return a - b;
          });

          return {
            byMethod,
            byStatus,
            bytes,
            durationMs: {
              max: durations.length ? durations[durations.length - 1] : null,
              min: durations.length ? durations[0] : null,
              p50: percentile(durations, 50),
              p95: percentile(durations, 95),
            },
            total: buffer.length,
          };
        },
      },
    },
  };
};
