import { describe, expect, it } from 'vitest';

import * as projectionEntry from '@/shared/projection';

// The barrel is the package's public `react-native-mcp-kit/projection` entry: custom modules built
// outside the kit project heavy JSON with the very same primitive the built-in ones use, so their
// output speaks one set of conventions.
describe('projection entry', () => {
  it('exposes the projection primitive and its schema helpers', () => {
    expect(typeof projectionEntry.projectValue).toBe('function');
    expect(typeof projectionEntry.projectAsValue).toBe('function');
    expect(typeof projectionEntry.applyProjection).toBe('function');
    expect(typeof projectionEntry.makeProjectionSchema).toBe('function');
    expect(typeof projectionEntry.isMarker).toBe('function');
    expect(projectionEntry.PROJECTION_SCHEMA).toBeDefined();
  });

  it('exposes the cap defaults the tool descriptions quote', () => {
    expect(projectionEntry.DEFAULT_DEPTH).toBe(1);
    expect(projectionEntry.MAX_DEPTH).toBe(8);
    expect(projectionEntry.DEFAULT_ARRAY_CAP).toBe(50);
    expect(projectionEntry.DEFAULT_OBJECT_CAP).toBe(30);
    expect(projectionEntry.DEFAULT_PREVIEW_CAP).toBe(250);
    expect(projectionEntry.DEFAULT_MAX_BYTES).toBe(50_000);
  });

  it('projects through the entry the same way the modules do', () => {
    const projected = projectionEntry.projectAsValue(
      { items: Array.from({ length: 4 }, (_, index) => ({ id: index })) },
      { arrayCap: 2, depth: 3 }
    ) as { items: unknown[] };

    expect(projected.items[0]).toEqual({ '${truncated}': { slice: [0, 2], total: 4 } });
  });
});
