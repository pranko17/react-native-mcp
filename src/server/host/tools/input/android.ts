import { type AppTargetError } from '@/server/host/helpers';
import { ProcessNotFoundError, type ProcessRunner } from '@/server/host/processRunner';

import { ANDROID_KEYCODES, INPUT_TIMEOUT_MS, KEY_NAMES } from './constants';

// `adb shell input text` maps characters through the default virtual keyboard
// keymap, which only covers ASCII. Anything outside that set crashes the input
// service with an opaque "Attempt to get length of null array" NPE. Refuse it
// up front with an actionable message.
// eslint-disable-next-line no-control-regex
const NON_ASCII_RE = /[^\x00-\x7F]/;

const escapeAdbInputText = (text: string): string => {
  const spaced = text.replace(/\s/g, '%s');
  return spaced.replace(/([\\'"`$&|;<>()[\]{}*?!#~])/g, '\\$1');
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

export const tapAndroid = (
  serial: string,
  x: number,
  y: number,
  runner: ProcessRunner
): Promise<{ ok: true } | AppTargetError> => {
  return runAdbInput(serial, ['tap', String(x), String(y)], runner, 'tap');
};

export const swipeAndroid = (
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

// Select all + delete, so typing replaces rather than appends (matches iOS).
// `input keycombination` sends keys simultaneously (Ctrl+A = select all).
const clearField = async (serial: string, runner: ProcessRunner): Promise<void> => {
  try {
    const selAll = await runner(
      'adb',
      ['-s', serial, 'shell', 'input', 'keycombination', '113', '29'],
      {
        timeoutMs: INPUT_TIMEOUT_MS,
      }
    );
    if (selAll.exitCode === 0) {
      await runAdbInput(serial, ['keyevent', 'KEYCODE_DEL'], runner, 'clear');
    }
  } catch {
    // keycombination not supported — skip clear, just append
  }
};

/**
 * Non-ASCII path: `adb shell input text` cannot encode it at all, so the text
 * goes onto the device clipboard (through the app, which is the only side that
 * can write it) and is delivered with a real KEYCODE_PASTE. That keeps the
 * input a genuine system paste — the focused field's own handlers run — rather
 * than a prop assignment behind React's back.
 */
const pasteTextAndroid = async (
  serial: string,
  text: string,
  runner: ProcessRunner,
  setClipboard: ClipboardWriter
): Promise<{ ok: true } | AppTargetError> => {
  const written = await setClipboard(text);
  if (!written.ok) {
    return {
      error: `Android cannot type non-ASCII via adb, and the clipboard fallback failed: ${written.error} Alternatively drive the field via fiber_tree__call on its onChangeText.`,
    };
  }
  await clearField(serial, runner);
  return runAdbInput(serial, ['keyevent', 'KEYCODE_PASTE'], runner, 'paste');
};

/** Writes text to the device clipboard via the connected app. */
export type ClipboardWriter = (
  text: string
) => Promise<{ ok: true } | { error: string; ok: false }>;

export const typeTextAndroid = async (
  serial: string,
  text: string,
  submit: boolean,
  runner: ProcessRunner,
  setClipboard?: ClipboardWriter
): Promise<{ ok: true } | AppTargetError> => {
  if (NON_ASCII_RE.test(text)) {
    if (!setClipboard) {
      return {
        error:
          'Android type_text only supports ASCII — `adb shell input text` has no code path for non-ASCII characters, and the clipboard fallback needs a connected app. Connect the app, or drive the field via fiber_tree__call on its onChangeText.',
      };
    }
    const pasted = await pasteTextAndroid(serial, text, runner, setClipboard);
    if ('error' in pasted) return pasted;
    if (submit) {
      return runAdbInput(serial, ['keyevent', 'KEYCODE_ENTER'], runner, 'submit');
    }
    return pasted;
  }

  await clearField(serial, runner);

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

export const pressKeyAndroid = (
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
