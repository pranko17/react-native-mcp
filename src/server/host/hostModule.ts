import { type ProcessRunner } from './processRunner';
import { screenshotTool } from './tools/capture';
import { connectionStatusTool } from './tools/connectionStatus';
import { listDevicesTool } from './tools/devices';
import { doctorTool } from './tools/doctor';
import {
  dragTool,
  longPressTool,
  pressKeyTool,
  swipeTool,
  tapTool,
  typeTextBatchTool,
  typeTextTool,
} from './tools/input';
import { launchAppTool, restartAppTool, terminateAppTool } from './tools/lifecycle';
import { tapFiberTool } from './tools/tapFiber';
import { type HostModule } from './types';

export const hostModule = (runner: ProcessRunner): HostModule => {
  return {
    name: 'host',
    tools: {
      connection_status: connectionStatusTool(),
      doctor: doctorTool(),
      drag: dragTool(runner),
      launch_app: launchAppTool(runner),
      list_devices: listDevicesTool(runner),
      long_press: longPressTool(runner),
      press_key: pressKeyTool(runner),
      restart_app: restartAppTool(runner),
      screenshot: screenshotTool(runner),
      swipe: swipeTool(runner),
      tap: tapTool(runner),
      tap_fiber: tapFiberTool(),
      terminate_app: terminateAppTool(runner),
      type_text: typeTextTool(runner),
      type_text_batch: typeTextBatchTool(runner),
    },
  };
};
