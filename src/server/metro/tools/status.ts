import { type HostToolHandler } from '@/server/host/types';
import { resolveMetroUrl } from '@/server/metro/resolveMetroUrl';

const METRO_TIMEOUT_MS = 3_000;
const PACKAGER_STATUS = 'packager-status:running';

export const statusTool = (): HostToolHandler => {
  return {
    description: `Ping Metro's \`/status\` endpoint — returns { running: true, metroUrl } when Metro is up and reachable, { running: false, error, metroUrl } when it's not.

Cheap, side-effect-free sanity check. Useful before a chain of Metro-facing operations (symbolicate, reload) to fail fast with a clear reason instead of a cascade of timeouts.`,
    handler: async (args, ctx) => {
      const metroUrl = resolveMetroUrl(args, ctx);
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
        }, METRO_TIMEOUT_MS);
        const res = await fetch(`${metroUrl}/status`, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) {
          return { error: `Metro responded ${res.status}`, metroUrl, running: false };
        }
        const body = (await res.text()).trim();
        const running = body === PACKAGER_STATUS;
        return running
          ? { metroUrl, running: true }
          : { body, error: `unexpected body: "${body}"`, metroUrl, running: false };
      } catch (err) {
        return {
          error: `Metro at ${metroUrl} unreachable: ${(err as Error).message}`,
          metroUrl,
          running: false,
        };
      }
    },
    inputSchema: {
      clientId: {
        description:
          'Target client ID — used to pick up the Metro URL the app was loaded from (falls back to `metroUrl` or the hardcoded default).',
        type: 'string',
      },
      metroUrl: {
        description: `Base URL of the Metro dev server. Overrides the URL reported by the connected client. Default "http://localhost:8081".`,
        type: 'string',
      },
    },
    timeout: METRO_TIMEOUT_MS + 1_000,
  };
};
