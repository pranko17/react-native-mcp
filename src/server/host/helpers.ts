import { z } from 'zod';

export interface AppTargetError {
  error: string;
}

// These three ship on every host tool — kept terse so the repeated text doesn't
// dominate the catalog. Device-resolution order is documented once in
// BASE_INSTRUCTIONS.
export const NATIVE_ID_SCHEMA = {
  serial: z
    .string()
    .describe('adb serial from host__list_devices. Overrides clientId + platform.')
    .optional(),
  udid: z
    .string()
    .describe('simctl UDID from host__list_devices. Overrides clientId + platform.')
    .optional(),
};

export const PLATFORM_ARG_SCHEMA = z
  .enum(['android', 'ios'])
  .describe('Platform filter. Ignored when clientId is given.')
  .optional();

export const parsePlatformArg = (value: unknown): 'android' | 'ios' | undefined => {
  return value === 'ios' || value === 'android' ? value : undefined;
};

export const parseStringArg = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

export const parseResolveOptions = (
  args: Record<string, unknown>
): { platform?: 'android' | 'ios'; serial?: string; udid?: string } => {
  return {
    platform: parsePlatformArg(args.platform),
    serial: parseStringArg(args.serial),
    udid: parseStringArg(args.udid),
  };
};

export const parseCoord = (
  value: unknown,
  name: string
): { ok: true; value: number } | { error: string; ok: false } => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return { error: `'${name}' must be a non-negative finite number`, ok: false };
  }
  return { ok: true, value: Math.floor(value) };
};
