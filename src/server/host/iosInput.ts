// iOS input injection via the bundled ios-hid Swift binary.
// ios-hid uses Apple private frameworks (SimulatorKit, CoreSimulator) to inject
// HID events directly into iOS Simulator — no WDA, no idb, no external deps.
// Coordinates are PHYSICAL PIXELS end-to-end, matching Android adb semantics
// and fiber_tree bounds — ios-hid passes them straight to the HID layer with
// screenSize loaded from SimDevice.deviceType.mainScreenSize (also pixels on
// Xcode 15+).

import { join } from 'node:path';

import { type AppTargetError } from './helpers';
import { ProcessNotFoundError, type ProcessRunner } from './processRunner';

const IOS_INPUT_TIMEOUT_MS = 5_000;

const getIosHidPath = (): string => {
  return join(__dirname, '..', '..', 'bin', 'ios-hid');
};

const runIosHid = async (
  runner: ProcessRunner,
  args: readonly string[],
  action: string
): Promise<{ ok: true } | AppTargetError> => {
  const bin = getIosHidPath();
  try {
    const proc = await runner(bin, args, { timeoutMs: IOS_INPUT_TIMEOUT_MS });
    if (proc.timedOut) {
      return { error: `iOS ${action} timed out after ${IOS_INPUT_TIMEOUT_MS}ms` };
    }
    if (proc.exitCode !== 0) {
      const stderr = proc.stderr.toString('utf8').trim();
      return {
        error: `iOS ${action} failed: ${stderr.slice(0, 500) || `exit code ${proc.exitCode}`}`,
      };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof ProcessNotFoundError) {
      return {
        error:
          'ios-hid binary not found. This usually means the package was installed on a non-macOS platform. iOS input injection requires macOS with Xcode.',
      };
    }
    return { error: `iOS ${action} failed: ${(err as Error).message}` };
  }
};

export const tapIos = async (
  udid: string,
  xPixels: number,
  yPixels: number,
  runner: ProcessRunner
): Promise<{ ok: true } | AppTargetError> => {
  return runIosHid(runner, ['tap', udid, String(xPixels), String(yPixels)], 'tap');
};

export const swipeIos = async (
  udid: string,
  x1Pixels: number,
  y1Pixels: number,
  x2Pixels: number,
  y2Pixels: number,
  durationMs: number,
  runner: ProcessRunner
): Promise<{ ok: true } | AppTargetError> => {
  return runIosHid(
    runner,
    [
      'swipe',
      udid,
      String(x1Pixels),
      String(y1Pixels),
      String(x2Pixels),
      String(y2Pixels),
      String(durationMs / 1000),
    ],
    'swipe'
  );
};

export const typeTextIos = async (
  udid: string,
  text: string,
  submit: boolean,
  runner: ProcessRunner
): Promise<{ ok: true } | AppTargetError> => {
  // ios-hid handles clipboard paste internally (simctl pbcopy + Cmd+V)
  // to avoid keyboard layout issues (HID keycodes are physical keys).
  const fullText = submit ? text + '\n' : text;
  return runIosHid(runner, ['type', udid, fullText], 'type');
};

// Keys that don't exist on iOS Simulator
const IOS_UNSUPPORTED_KEYS = new Set(['back', 'menu', 'power', 'volume_down', 'volume_up']);

const IOS_BUTTON_MAP: Record<string, string> = {
  home: 'home',
};

const IOS_KEY_TEXT: Record<string, string> = {
  backspace: '\u007F',
  enter: '\n',
  escape: '\u001B',
  space: ' ',
  tab: '\t',
};

export const pressKeyIos = async (
  udid: string,
  key: string,
  runner: ProcessRunner
): Promise<{ ok: true } | AppTargetError> => {
  if (IOS_UNSUPPORTED_KEYS.has(key)) {
    return {
      error: `Key '${key}' is not available on iOS Simulator. Supported: enter, tab, space, backspace, escape, home.`,
    };
  }

  const button = IOS_BUTTON_MAP[key];
  if (button) {
    return runIosHid(runner, ['button', udid, button], 'button');
  }

  const keyText = IOS_KEY_TEXT[key];
  if (keyText) {
    return runIosHid(runner, ['type', udid, keyText], 'key');
  }

  return { error: `Unknown key '${key}' for iOS.` };
};
