import { type HostModule } from '@/server/host/types';

import { getEventsTool } from './tools/events';
import { openInEditorTool } from './tools/openInEditor';
import { reloadTool } from './tools/reload';
import { statusTool } from './tools/status';
import { symbolicateTool } from './tools/symbolicate';

export const metroModule = (): HostModule => {
  return {
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
