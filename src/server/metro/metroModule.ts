import { type HostModule } from '@/server/host/types';

import { getEventsTool } from './tools/events';
import { openInEditorTool } from './tools/openInEditor';
import { reloadTool } from './tools/reload';
import { statusTool } from './tools/status';
import { symbolicateTool } from './tools/symbolicate';

export const metroModule = (): HostModule => {
  return {
    description: `Metro dev-server control plane. Tools here talk HTTP / WS to the Metro instance the React Native app was bundled from — the URL is auto-detected from each client's handshake (scriptURL), so non-default ports and LAN-connected physical devices work without extra config. Falls back to http://localhost:8081 when the app didn't report a dev-server (production builds, detection failure).

All tools no-op gracefully with { skipped: true, error } when Metro is unreachable.`,
    name: 'metro',
    tools: {
      get_events: getEventsTool(),
      open_in_editor: openInEditorTool(),
      reload: reloadTool(),
      status: statusTool(),
      symbolicate: symbolicateTool(),
    },
  };
};
