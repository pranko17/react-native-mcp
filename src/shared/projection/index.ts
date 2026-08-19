/**
 * Public projection surface.
 *
 * Every built-in module funnels heavy JSON through `projectValue` before it reaches an agent:
 * containers are walked to a depth budget, wide ones are width-capped, long strings become
 * previews, and everything cut is replaced by a sentinel marker (`${truncated}`, `${str}`,
 * `${obj}`, `${cyc}`). Custom modules need the same primitive — a hand-rolled serializer would
 * speak different conventions than the rest of the catalog, so the agent could not read both
 * with one set of expectations.
 *
 * Import it as `react-native-mcp-kit/projection`.
 */
export {
  applyProjection,
  DEFAULT_ARRAY_CAP,
  DEFAULT_DEPTH,
  DEFAULT_MAX_BYTES,
  DEFAULT_OBJECT_CAP,
  DEFAULT_PREVIEW_CAP,
  isMarker,
  MAX_DEPTH,
  makeProjectionSchema,
  PROJECTION_SCHEMA,
  projectAsValue,
  projectValue,
  type CollapseRule,
  type ProjectionArgs,
  type ProjectOptions,
  type ProjectResult,
  type Projector,
} from './projectValue';

export { type RedactPatterns } from './redact';
