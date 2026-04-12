import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';

import { resolveDevice } from '@/server/host/deviceResolver';
import { NATIVE_ID_SCHEMA, PLATFORM_ARG_SCHEMA, parseResolveOptions } from '@/server/host/helpers';
import { ProcessNotFoundError, type ProcessRunner } from '@/server/host/processRunner';
import { type HostToolHandler } from '@/server/host/types';

const SCREENSHOT_TIMEOUT_MS = 15_000;
const SCREENSHOT_DEFAULT_WIDTH = 370;
const SCREENSHOT_MIN_WIDTH = 64;
const SCREENSHOT_MAX_WIDTH = 1568;

const clampWidth = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return SCREENSHOT_DEFAULT_WIDTH;
  }
  return Math.max(SCREENSHOT_MIN_WIDTH, Math.min(SCREENSHOT_MAX_WIDTH, Math.floor(value)));
};

const resizeScreenshot = async (input: Buffer, targetWidth: number): Promise<Buffer> => {
  return sharp(input)
    .resize({ width: targetWidth, withoutEnlargement: true })
    .png({ compressionLevel: 6 })
    .toBuffer();
};

interface ScreenshotImage {
  data: string;
  mimeType: 'image/png';
  type: 'image';
}

interface ScreenshotError {
  error: string;
}

const captureIos = async (
  udid: string,
  runner: ProcessRunner,
  width: number
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
    const raw = await readFile(tmpPath);
    const resized = await resizeScreenshot(raw, width);
    return [
      {
        data: resized.toString('base64'),
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
  runner: ProcessRunner,
  width: number
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
    const resized = await resizeScreenshot(proc.stdout, width);
    return [
      {
        data: resized.toString('base64'),
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

export const screenshotTool = (runner: ProcessRunner): HostToolHandler => {
  return {
    description: `Capture a PNG screenshot from an iOS simulator or Android device, resized to save vision tokens. Default width ${SCREENSHOT_DEFAULT_WIDTH}px (pass \`width\` to override, max ${SCREENSHOT_MAX_WIDTH}). For tap targeting prefer fiber_tree__find_all bounds — screenshots are only needed for visual verification or when targeting non-React surfaces.`,
    handler: async (args, ctx) => {
      const resolved = await resolveDevice(ctx, parseResolveOptions(args), runner);
      if (!resolved.ok) {
        return { error: resolved.error };
      }
      const width = clampWidth(args.width);
      if (resolved.device.platform === 'ios') {
        return captureIos(resolved.device.nativeId, runner, width);
      }
      return captureAndroid(resolved.device.nativeId, runner, width);
    },
    inputSchema: {
      platform: PLATFORM_ARG_SCHEMA,
      width: {
        description: `Output width in pixels. Aspect ratio preserved, height auto-computed. Default ${SCREENSHOT_DEFAULT_WIDTH}. Capped to ${SCREENSHOT_MIN_WIDTH}..${SCREENSHOT_MAX_WIDTH}. Use higher values when you need to read small text; default is enough for visual verification.`,
        type: 'number',
      },
      ...NATIVE_ID_SCHEMA,
    },
    timeout: SCREENSHOT_TIMEOUT_MS,
  };
};

export { SCREENSHOT_TIMEOUT_MS };
