export type HttpMethod = 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT';

/**
 * Body captured on request or response. For tiny / moderate payloads we keep
 * the fully-parsed `data` inline. Bodies larger than `bodyMaxBytes` get their
 * `data` dropped and a `preview` plus `truncated: true` marker is kept instead,
 * so memory stays bounded even under pagination / feed responses.
 */
export interface CapturedBody {
  bytes: number;
  data?: unknown;
  preview?: string;
  truncated?: true;
}

export interface NetworkEntry {
  duration: number | null;
  id: number;
  method: string;
  request: {
    headers: Record<string, string>;
    body?: CapturedBody;
  };
  response: {
    headers: Record<string, string>;
    status: number;
    body?: CapturedBody;
  } | null;
  startedAt: string;
  status: 'error' | 'pending' | 'success';
  url: string;
}

export interface NetworkModuleOptions {
  /**
   * Cap on stored body size (bytes). Bodies above this keep only a preview +
   * byte count. Default 20_000 (20KB) — protects against megabyte feeds.
   * Pass 0 to disable capture entirely.
   */
  bodyMaxBytes?: number;
  /** Ignore URLs matching these patterns (e.g. WebSocket, Metro bundler) */
  ignoreUrls?: Array<string | RegExp>;
  /** Include request/response bodies at capture time (default: true) */
  includeBodies?: boolean;
  /** Max entries in the buffer (default: 100) */
  maxEntries?: number;
  /**
   * Body keys (case-insensitive) to redact before storing. Recursively matches
   * nested objects. Default: ['password','token','accessToken','refreshToken',
   * 'apiKey','secret','otp','pin']. Pass false to disable, [] to keep defaults
   * only when explicitly empty.
   */
  redactBodyKeys?: string[] | false;
  /**
   * Header names (case-insensitive) to replace with "[redacted]" before
   * storing. Default: ['authorization','cookie','set-cookie','x-api-key',
   * 'x-auth-token','x-access-token']. Pass false to disable.
   */
  redactHeaders?: string[] | false;
}
