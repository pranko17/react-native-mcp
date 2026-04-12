import { resolveDevice } from '@/server/host/deviceResolver';
import {
  type AppTargetError,
  NATIVE_ID_SCHEMA,
  parseCoord,
  parseResolveOptions,
  parseStringArg,
  PLATFORM_ARG_SCHEMA,
} from '@/server/host/helpers';
import { ProcessNotFoundError, type ProcessRunner } from '@/server/host/processRunner';
import { type HostToolHandler } from '@/server/host/types';

const INPUT_TIMEOUT_MS = 5_000;
const SWIPE_DURATION_DEFAULT_MS = 300;
const SWIPE_DURATION_MIN_MS = 50;
const SWIPE_DURATION_MAX_MS = 5_000;

const ANDROID_KEYCODES: Record<string, string> = {
  back: 'KEYCODE_BACK',
  backspace: 'KEYCODE_DEL',
  enter: 'KEYCODE_ENTER',
  escape: 'KEYCODE_ESCAPE',
  home: 'KEYCODE_HOME',
  menu: 'KEYCODE_MENU',
  power: 'KEYCODE_POWER',
  space: 'KEYCODE_SPACE',
  tab: 'KEYCODE_TAB',
  volume_down: 'KEYCODE_VOLUME_DOWN',
  volume_up: 'KEYCODE_VOLUME_UP',
};

const KEY_NAMES = Object.keys(ANDROID_KEYCODES).sort();

const escapeAdbInputText = (text: string): string => {
  const spaced = text.replace(/\s/g, '%s');
  return spaced.replace(/([\\'"`$&|;<>()[\]{}*?!#~])/g, '\\$1');
};

const clampSwipeDuration = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return SWIPE_DURATION_DEFAULT_MS;
  }
  return Math.max(SWIPE_DURATION_MIN_MS, Math.min(SWIPE_DURATION_MAX_MS, Math.floor(value)));
};

const runAdbInput = async (
  serial: string,
  args: readonly string[],
  runner: ProcessRunner,
  action: string
): Promise<{ ok: true } | AppTargetError> => {
  try {
    const proc = await runner('adb', ['-s', serial, 'shell', 'input', ...args], {
      timeoutMs: INPUT_TIMEOUT_MS,
    });
    if (proc.timedOut) {
      return { error: `Android ${action} timed out after ${INPUT_TIMEOUT_MS}ms` };
    }
    if (proc.exitCode !== 0) {
      return {
        error: `adb shell input ${action} failed (exit ${proc.exitCode}): ${proc.stderr.toString('utf8').trim().slice(0, 500)}`,
      };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof ProcessNotFoundError) {
      return {
        error: 'adb not found. Android host tools require Android platform-tools on PATH.',
      };
    }
    return { error: `Failed to run Android ${action}: ${(err as Error).message}` };
  }
};

const tapAndroid = (
  serial: string,
  x: number,
  y: number,
  runner: ProcessRunner
): Promise<{ ok: true } | AppTargetError> => {
  return runAdbInput(serial, ['tap', String(x), String(y)], runner, 'tap');
};

const swipeAndroid = (
  serial: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs: number,
  runner: ProcessRunner
): Promise<{ ok: true } | AppTargetError> => {
  return runAdbInput(
    serial,
    ['swipe', String(x1), String(y1), String(x2), String(y2), String(durationMs)],
    runner,
    'swipe'
  );
};

const typeTextAndroid = async (
  serial: string,
  text: string,
  submit: boolean,
  runner: ProcessRunner
): Promise<{ ok: true } | AppTargetError> => {
  const escaped = escapeAdbInputText(text);
  const typed = await runAdbInput(serial, ['text', escaped], runner, 'text');
  if ('error' in typed) {
    return typed;
  }
  if (submit) {
    return runAdbInput(serial, ['keyevent', 'KEYCODE_ENTER'], runner, 'submit');
  }
  return typed;
};

const pressKeyAndroid = (
  serial: string,
  key: string,
  runner: ProcessRunner
): Promise<{ ok: true } | AppTargetError> => {
  const keycode = ANDROID_KEYCODES[key];
  if (!keycode) {
    return Promise.resolve({
      error: `Unknown key '${key}'. Supported: ${KEY_NAMES.join(', ')}.`,
    });
  }
  return runAdbInput(serial, ['keyevent', keycode], runner, 'keyevent');
};

const iosInputNotSupported = (toolName: string): AppTargetError => {
  return {
    error: `${toolName} on iOS requires WebDriverAgent integration (planned follow-up commit). Use an Android target for now, or use fiber_tree__invoke on the connected client for in-app interactions.`,
  };
};

export const tapTool = (runner: ProcessRunner): HostToolHandler => {
  return {
    description:
      'Prefer fiber_tree__invoke for React-rendered components, or fiber_tree__find_all with select: ["mcpId", "name", "bounds"] + bounds.centerX/centerY for OS-gesture testing. Use this raw-coordinate tap only for non-React surfaces (system dialogs, keyboard, WebView). Tap at absolute pixel coordinates (x, y) via adb shell input tap. Top-left origin. iOS support is a planned follow-up via WebDriverAgent.',
    handler: async (args, ctx) => {
      const resolved = await resolveDevice(ctx, parseResolveOptions(args), runner);
      if (!resolved.ok) {
        return { error: resolved.error };
      }
      if (resolved.device.platform === 'ios') {
        return iosInputNotSupported('host__tap');
      }
      const x = parseCoord(args.x, 'x');
      if (!x.ok) return { error: x.error };
      const y = parseCoord(args.y, 'y');
      if (!y.ok) return { error: y.error };
      const result = await tapAndroid(resolved.device.nativeId, x.value, y.value, runner);
      if ('error' in result) {
        return { error: result.error };
      }
      return { device: resolved.device, tapped: true, x: x.value, y: y.value };
    },
    inputSchema: {
      platform: PLATFORM_ARG_SCHEMA,
      x: {
        description: 'Absolute x pixel coordinate (top-left origin).',
        type: 'number',
      },
      y: {
        description: 'Absolute y pixel coordinate (top-left origin).',
        type: 'number',
      },
      ...NATIVE_ID_SCHEMA,
    },
    timeout: INPUT_TIMEOUT_MS,
  };
};

export const swipeTool = (runner: ProcessRunner): HostToolHandler => {
  return {
    description:
      'Swipe (or scroll) from (x1, y1) to (x2, y2) on the target device via adb shell input swipe. Coordinates are absolute pixels, top-left origin. durationMs defaults to 300 and is clamped to 50..5000. iOS support is a planned follow-up via WebDriverAgent.',
    handler: async (args, ctx) => {
      const resolved = await resolveDevice(ctx, parseResolveOptions(args), runner);
      if (!resolved.ok) {
        return { error: resolved.error };
      }
      if (resolved.device.platform === 'ios') {
        return iosInputNotSupported('host__swipe');
      }
      const x1 = parseCoord(args.x1, 'x1');
      if (!x1.ok) return { error: x1.error };
      const y1 = parseCoord(args.y1, 'y1');
      if (!y1.ok) return { error: y1.error };
      const x2 = parseCoord(args.x2, 'x2');
      if (!x2.ok) return { error: x2.error };
      const y2 = parseCoord(args.y2, 'y2');
      if (!y2.ok) return { error: y2.error };
      const durationMs = clampSwipeDuration(args.durationMs);
      const result = await swipeAndroid(
        resolved.device.nativeId,
        x1.value,
        y1.value,
        x2.value,
        y2.value,
        durationMs,
        runner
      );
      if ('error' in result) {
        return { error: result.error };
      }
      return {
        device: resolved.device,
        durationMs,
        from: { x: x1.value, y: y1.value },
        swiped: true,
        to: { x: x2.value, y: y2.value },
      };
    },
    inputSchema: {
      durationMs: {
        description: `Total swipe duration in milliseconds. Default ${SWIPE_DURATION_DEFAULT_MS}. Clamped to ${SWIPE_DURATION_MIN_MS}..${SWIPE_DURATION_MAX_MS}.`,
        type: 'number',
      },
      platform: PLATFORM_ARG_SCHEMA,
      x1: {
        description: 'Start x pixel coordinate (top-left origin).',
        type: 'number',
      },
      x2: {
        description: 'End x pixel coordinate (top-left origin).',
        type: 'number',
      },
      y1: {
        description: 'Start y pixel coordinate (top-left origin).',
        type: 'number',
      },
      y2: {
        description: 'End y pixel coordinate (top-left origin).',
        type: 'number',
      },
      ...NATIVE_ID_SCHEMA,
    },
    timeout: INPUT_TIMEOUT_MS + SWIPE_DURATION_MAX_MS,
  };
};

export const typeTextTool = (runner: ProcessRunner): HostToolHandler => {
  return {
    description:
      'Type text into the currently focused input field on the target device via adb shell input text. Escapes whitespace and shell metacharacters automatically. Pass submit=true to press ENTER after typing (e.g. to submit a search). iOS support is a planned follow-up via WebDriverAgent.',
    handler: async (args, ctx) => {
      const resolved = await resolveDevice(ctx, parseResolveOptions(args), runner);
      if (!resolved.ok) {
        return { error: resolved.error };
      }
      if (resolved.device.platform === 'ios') {
        return iosInputNotSupported('host__type_text');
      }
      const text = typeof args.text === 'string' ? args.text : undefined;
      if (text === undefined) {
        return { error: "'text' is required and must be a string" };
      }
      const submit = args.submit === true;
      const result = await typeTextAndroid(resolved.device.nativeId, text, submit, runner);
      if ('error' in result) {
        return { error: result.error };
      }
      return {
        device: resolved.device,
        length: text.length,
        submitted: submit,
        typed: true,
      };
    },
    inputSchema: {
      platform: PLATFORM_ARG_SCHEMA,
      submit: {
        description: 'Press ENTER after typing (e.g. to submit a search). Default false.',
        type: 'boolean',
      },
      text: {
        description:
          'Text to type into the currently focused input field. Whitespace and shell metacharacters are escaped automatically.',
        type: 'string',
      },
      ...NATIVE_ID_SCHEMA,
    },
    timeout: INPUT_TIMEOUT_MS,
  };
};

export const pressKeyTool = (runner: ProcessRunner): HostToolHandler => {
  return {
    description: `Press a hardware/semantic key on the target device via adb shell input keyevent. Accepted key names: ${KEY_NAMES.join(', ')}. iOS support is a planned follow-up via WebDriverAgent. Target device resolution: explicit udid/serial > outer clientId > platform + auto-pick > bare scan.`,
    handler: async (args, ctx) => {
      const resolved = await resolveDevice(ctx, parseResolveOptions(args), runner);
      if (!resolved.ok) {
        return { error: resolved.error };
      }
      if (resolved.device.platform === 'ios') {
        return iosInputNotSupported('host__press_key');
      }
      const key = parseStringArg(args.key);
      if (!key) {
        return { error: `'key' is required. Supported: ${KEY_NAMES.join(', ')}.` };
      }
      const result = await pressKeyAndroid(resolved.device.nativeId, key, runner);
      if ('error' in result) {
        return { error: result.error };
      }
      return { device: resolved.device, key, pressed: true };
    },
    inputSchema: {
      key: {
        description: `Semantic key name. Mapped to the target platform's native key code internally. Supported: ${KEY_NAMES.join(', ')}.`,
        enum: KEY_NAMES,
        type: 'string',
      },
      platform: PLATFORM_ARG_SCHEMA,
      ...NATIVE_ID_SCHEMA,
    },
    timeout: INPUT_TIMEOUT_MS,
  };
};
