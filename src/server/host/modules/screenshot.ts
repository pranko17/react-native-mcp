import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  enrichDevicesWithClientStatus,
  resolveDevice,
  type ResolvedDevice,
} from '@/server/host/deviceResolver';
import { ProcessNotFoundError, type ProcessRunner } from '@/server/host/processRunner';
import { type HostContext, type HostModule } from '@/server/host/types';

const SCREENSHOT_TIMEOUT_MS = 15_000;
const LAUNCH_TIMEOUT_MS = 15_000;

interface ScreenshotImage {
  data: string;
  mimeType: 'image/png';
  type: 'image';
}

interface ScreenshotError {
  error: string;
}

interface LaunchSuccess {
  bundleId: string;
  device: ResolvedDevice;
  launched: true;
}

interface TerminateSuccess {
  bundleId: string;
  device: ResolvedDevice;
  terminated: true;
}

interface AppTargetError {
  error: string;
}

interface ResolvedLaunchTarget {
  bundleId: string;
  device: ResolvedDevice;
  ok: true;
}

type LaunchTargetResolution = ResolvedLaunchTarget | { error: string; ok: false };

const captureIos = async (
  udid: string,
  runner: ProcessRunner
): Promise<[ScreenshotImage] | ScreenshotError> => {
  const tmpPath = join(tmpdir(), `rnmcp-ios-${randomUUID()}.png`);
  try {
    const proc = await runner('xcrun', ['simctl', 'io', udid, 'screenshot', tmpPath], {
      timeoutMs: SCREENSHOT_TIMEOUT_MS,
    });
    if (proc.timedOut) {
      return { error: `iOS screenshot timed out after ${SCREENSHOT_TIMEOUT_MS}ms` };
    }
    if (proc.exitCode !== 0) {
      return {
        error: `xcrun simctl io screenshot failed (exit ${proc.exitCode}): ${proc.stderr.toString('utf8').trim().slice(0, 500)}`,
      };
    }
    const buffer = await readFile(tmpPath);
    return [
      {
        data: buffer.toString('base64'),
        mimeType: 'image/png',
        type: 'image',
      },
    ];
  } catch (err) {
    if (err instanceof ProcessNotFoundError) {
      return {
        error: 'xcrun not found. iOS screenshots require Xcode command line tools.',
      };
    }
    return { error: `Failed to capture iOS screenshot: ${(err as Error).message}` };
  } finally {
    rm(tmpPath, { force: true }).catch(() => {
      // best-effort cleanup
    });
  }
};

const captureAndroid = async (
  serial: string,
  runner: ProcessRunner
): Promise<[ScreenshotImage] | ScreenshotError> => {
  try {
    const proc = await runner('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], {
      timeoutMs: SCREENSHOT_TIMEOUT_MS,
    });
    if (proc.timedOut) {
      return { error: `Android screenshot timed out after ${SCREENSHOT_TIMEOUT_MS}ms` };
    }
    if (proc.exitCode !== 0) {
      return {
        error: `adb screencap failed (exit ${proc.exitCode}): ${proc.stderr.toString('utf8').trim().slice(0, 500)}`,
      };
    }
    if (proc.stdout.length === 0) {
      return { error: 'adb screencap returned empty output' };
    }
    return [
      {
        data: proc.stdout.toString('base64'),
        mimeType: 'image/png',
        type: 'image',
      },
    ];
  } catch (err) {
    if (err instanceof ProcessNotFoundError) {
      return {
        error: 'adb not found. Android screenshots require Android platform-tools on PATH.',
      };
    }
    return {
      error: `Failed to capture Android screenshot: ${(err as Error).message}`,
    };
  }
};

const launchIos = async (
  udid: string,
  bundleId: string,
  runner: ProcessRunner
): Promise<{ ok: true } | AppTargetError> => {
  try {
    const proc = await runner('xcrun', ['simctl', 'launch', udid, bundleId], {
      timeoutMs: LAUNCH_TIMEOUT_MS,
    });
    if (proc.timedOut) {
      return { error: `iOS launch timed out after ${LAUNCH_TIMEOUT_MS}ms` };
    }
    if (proc.exitCode !== 0) {
      return {
        error: `xcrun simctl launch failed (exit ${proc.exitCode}): ${proc.stderr.toString('utf8').trim().slice(0, 500)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof ProcessNotFoundError) {
      return {
        error: 'xcrun not found. iOS launch requires Xcode command line tools.',
      };
    }
    return { error: `Failed to launch iOS app: ${(err as Error).message}` };
  }
};

const launchAndroid = async (
  serial: string,
  packageName: string,
  runner: ProcessRunner
): Promise<{ ok: true } | AppTargetError> => {
  try {
    const proc = await runner(
      'adb',
      [
        '-s',
        serial,
        'shell',
        'monkey',
        '-p',
        packageName,
        '-c',
        'android.intent.category.LAUNCHER',
        '1',
      ],
      { timeoutMs: LAUNCH_TIMEOUT_MS }
    );
    if (proc.timedOut) {
      return { error: `Android launch timed out after ${LAUNCH_TIMEOUT_MS}ms` };
    }
    if (proc.exitCode !== 0) {
      return {
        error: `adb shell monkey failed (exit ${proc.exitCode}): ${proc.stderr.toString('utf8').trim().slice(0, 500)}`,
      };
    }
    // monkey reports "No activities found to run, monkey aborted." to stdout on missing packages
    const stdoutText = proc.stdout.toString('utf8');
    if (stdoutText.includes('No activities found')) {
      return {
        error: `adb shell monkey: no launcher activity found for package '${packageName}'. Is the app installed?`,
      };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof ProcessNotFoundError) {
      return {
        error: 'adb not found. Android launch requires Android platform-tools on PATH.',
      };
    }
    return { error: `Failed to launch Android app: ${(err as Error).message}` };
  }
};

const terminateIos = async (
  udid: string,
  bundleId: string,
  runner: ProcessRunner
): Promise<{ ok: true } | AppTargetError> => {
  try {
    const proc = await runner('xcrun', ['simctl', 'terminate', udid, bundleId], {
      timeoutMs: LAUNCH_TIMEOUT_MS,
    });
    if (proc.timedOut) {
      return { error: `iOS terminate timed out after ${LAUNCH_TIMEOUT_MS}ms` };
    }
    if (proc.exitCode !== 0) {
      return {
        error: `xcrun simctl terminate failed (exit ${proc.exitCode}): ${proc.stderr.toString('utf8').trim().slice(0, 500)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof ProcessNotFoundError) {
      return {
        error: 'xcrun not found. iOS terminate requires Xcode command line tools.',
      };
    }
    return { error: `Failed to terminate iOS app: ${(err as Error).message}` };
  }
};

const terminateAndroid = async (
  serial: string,
  packageName: string,
  runner: ProcessRunner
): Promise<{ ok: true } | AppTargetError> => {
  try {
    const proc = await runner('adb', ['-s', serial, 'shell', 'am', 'force-stop', packageName], {
      timeoutMs: LAUNCH_TIMEOUT_MS,
    });
    if (proc.timedOut) {
      return { error: `Android terminate timed out after ${LAUNCH_TIMEOUT_MS}ms` };
    }
    // am force-stop returns exit 0 even for non-existent packages (known quirk),
    // but we still surface any unexpected non-zero exit as an error.
    if (proc.exitCode !== 0) {
      return {
        error: `adb shell am force-stop failed (exit ${proc.exitCode}): ${proc.stderr.toString('utf8').trim().slice(0, 500)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof ProcessNotFoundError) {
      return {
        error: 'adb not found. Android terminate requires Android platform-tools on PATH.',
      };
    }
    return { error: `Failed to terminate Android app: ${(err as Error).message}` };
  }
};

const parsePlatformArg = (value: unknown): 'android' | 'ios' | undefined => {
  return value === 'ios' || value === 'android' ? value : undefined;
};

const parseStringArg = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const parseResolveOptions = (
  args: Record<string, unknown>
): { platform?: 'android' | 'ios'; serial?: string; udid?: string } => {
  return {
    platform: parsePlatformArg(args.platform),
    serial: parseStringArg(args.serial),
    udid: parseStringArg(args.udid),
  };
};

const resolveLaunchTarget = async (
  ctx: HostContext,
  args: Record<string, unknown>,
  runner: ProcessRunner
): Promise<LaunchTargetResolution> => {
  const resolved = await resolveDevice(ctx, parseResolveOptions(args), runner);
  if (!resolved.ok) {
    return { error: resolved.error, ok: false };
  }
  const explicitAppId = parseStringArg(args.appId);
  const bundleId = explicitAppId ?? resolved.device.bundleId;
  if (!bundleId) {
    return {
      error:
        "appId required. Pass it explicitly (e.g. 'by.21vek.mobile') or target a clientId whose client registered its bundleId metadata.",
      ok: false,
    };
  }
  return { bundleId, device: resolved.device, ok: true };
};

const NATIVE_ID_SCHEMA = {
  serial: {
    description:
      'Optional explicit adb serial of the target Android device (e.g. "emulator-5554"). Highest priority — bypasses clientId and platform-based device selection. Use values from host__list_devices output.',
    type: 'string',
  },
  udid: {
    description:
      'Optional explicit simctl UDID of the target iOS simulator. Highest priority — bypasses clientId and platform-based device selection. Use values from host__list_devices output.',
    type: 'string',
  },
} as const;

export const hostModule = (runner: ProcessRunner): HostModule => {
  return {
    description:
      'OS-level operations that run on the MCP server host via xcrun simctl / adb. Works when the React Native app is hung, disconnected, or not installed.',
    name: 'host',
    tools: {
      launch_app: {
        description:
          "Launch an installed app on a booted iOS simulator (xcrun simctl launch) or Android emulator/device (adb shell monkey). Pass `appId` explicitly (iOS bundle ID or Android package name), or omit it to fall back to the target client's registered bundleId metadata. Target device resolution: explicit `udid`/`serial` > outer `clientId` > `platform` + auto-pick > bare scan. Real iOS devices are not supported.",
        handler: async (args, ctx) => {
          const target = await resolveLaunchTarget(ctx, args, runner);
          if (!target.ok) {
            return { error: target.error };
          }
          const result =
            target.device.platform === 'ios'
              ? await launchIos(target.device.nativeId, target.bundleId, runner)
              : await launchAndroid(target.device.nativeId, target.bundleId, runner);
          if ('error' in result) {
            return { error: result.error };
          }
          const success: LaunchSuccess = {
            bundleId: target.bundleId,
            device: target.device,
            launched: true,
          };
          return success;
        },
        inputSchema: {
          appId: {
            description:
              'iOS bundle ID or Android package name. Optional when targeting a connected client whose registration metadata includes bundleId.',
            type: 'string',
          },
          platform: {
            description:
              'Optional platform filter: "ios" or "android". Ignored when clientId is provided on the outer call tool (the client\'s own platform is used instead).',
            enum: ['android', 'ios'],
            type: 'string',
          },
          ...NATIVE_ID_SCHEMA,
        },
        timeout: LAUNCH_TIMEOUT_MS,
      },
      list_devices: {
        description:
          'List all iOS simulators (booted or not) and Android devices (online or offline) visible via xcrun simctl / adb. Each device is annotated with connected=true and a clientId when it matches a currently-connected React Native client. Connected devices appear first in each platform group.',
        handler: async (_args, ctx) => {
          return enrichDevicesWithClientStatus(ctx.bridge, runner);
        },
        inputSchema: {},
        timeout: SCREENSHOT_TIMEOUT_MS,
      },
      screenshot: {
        description:
          'Capture a raw PNG screenshot from an iOS simulator (xcrun simctl io) or Android device (adb exec-out screencap). Target device resolution: explicit `udid`/`serial` > outer `clientId` > `platform` + auto-pick > bare scan.',
        handler: async (args, ctx) => {
          const resolved = await resolveDevice(ctx, parseResolveOptions(args), runner);
          if (!resolved.ok) {
            return { error: resolved.error };
          }
          if (resolved.device.platform === 'ios') {
            return captureIos(resolved.device.nativeId, runner);
          }
          return captureAndroid(resolved.device.nativeId, runner);
        },
        inputSchema: {
          platform: {
            description:
              'Optional platform filter: "ios" or "android". Ignored when clientId is provided on the outer call tool (the client\'s own platform is used instead).',
            enum: ['android', 'ios'],
            type: 'string',
          },
          ...NATIVE_ID_SCHEMA,
        },
        timeout: SCREENSHOT_TIMEOUT_MS,
      },
      terminate_app: {
        description:
          "Terminate (force-stop) an installed app on a booted iOS simulator (xcrun simctl terminate) or Android emulator/device (adb shell am force-stop). Pass `appId` explicitly or omit it to fall back to the target client's registered bundleId metadata. Target device resolution: explicit `udid`/`serial` > outer `clientId` > `platform` + auto-pick > bare scan. Real iOS devices are not supported.",
        handler: async (args, ctx) => {
          const target = await resolveLaunchTarget(ctx, args, runner);
          if (!target.ok) {
            return { error: target.error };
          }
          const result =
            target.device.platform === 'ios'
              ? await terminateIos(target.device.nativeId, target.bundleId, runner)
              : await terminateAndroid(target.device.nativeId, target.bundleId, runner);
          if ('error' in result) {
            return { error: result.error };
          }
          const success: TerminateSuccess = {
            bundleId: target.bundleId,
            device: target.device,
            terminated: true,
          };
          return success;
        },
        inputSchema: {
          appId: {
            description:
              'iOS bundle ID or Android package name. Optional when targeting a connected client whose registration metadata includes bundleId.',
            type: 'string',
          },
          platform: {
            description:
              'Optional platform filter: "ios" or "android". Ignored when clientId is provided on the outer call tool (the client\'s own platform is used instead).',
            enum: ['android', 'ios'],
            type: 'string',
          },
          ...NATIVE_ID_SCHEMA,
        },
        timeout: LAUNCH_TIMEOUT_MS,
      },
    },
  };
};
