import { z } from 'zod';

// ---------------------------------------------------------------------------
// Closed enums — the snapshot contract's hard-coded vocabularies.
//
// These are the canonical Zod sources for the four code vocabularies used
// across the snapshot families. Per the SHARED CONTRACTS, `$lib/v1/schemas`
// re-exports the *value-type* aliases (StatusCode / OccupancyCode /
// SeverityCode / Grain) for every consumer (filters, dataviz token mapping,
// nav, components). Keep these closed: the pipeline emits exactly these values
// and anything else is a contract break we want parsePort() to reject.
//
// Dataviz token mapping (consumer side): map an enum value to a CSS token
// suffix by replacing '_' with '-', e.g. 'on_time' -> --dataviz-status-on-time.
// ---------------------------------------------------------------------------

/** Realtime delay band. Glyphs: early ▼ on_time ● late ▲ severe ◆ unknown ○. */
export const StatusCodeSchema = z.enum(['early', 'on_time', 'late', 'severe', 'unknown']);
export type StatusCode = z.infer<typeof StatusCodeSchema>;

/** GTFS-rt occupancy bucket (coarsened to 5 bands). */
export const OccupancyCodeSchema = z.enum(['empty', 'many_seats', 'few_seats', 'standing', 'full']);
export type OccupancyCode = z.infer<typeof OccupancyCodeSchema>;

/** Service-alert severity. */
export const SeverityCodeSchema = z.enum(['critical', 'high', 'watch']);
export type SeverityCode = z.infer<typeof SeverityCodeSchema>;

/**
 * Reliability rollup grain. NOTE: this is the *web filter* grain vocabulary
 * (SHARED CONTRACT: Grain='live'|'day'|'week'|'month'). The snapshot reliability
 * `period.grain` field is a free string the pipeline owns and is NOT validated
 * against this enum — see the per-family schemas, which keep `grain: z.string()`.
 */
export const GrainSchema = z.enum(['live', 'day', 'week', 'month']);
export type Grain = z.infer<typeof GrainSchema>;

/**
 * Canonical code tuples — the SINGLE SOURCE every consumer (aggregate, filters,
 * the kit gallery) imports. Derived from the zod enums above via `.options`, so
 * they can never drift from the validated contract.
 */
export const STATUS_CODES = StatusCodeSchema.options;
export const OCCUPANCY_CODES = OccupancyCodeSchema.options;
export const SEVERITY_CODES = SeverityCodeSchema.options;
export const GRAINS = GrainSchema.options;

// ---------------------------------------------------------------------------
// IsoUtc string brand.
//
// Every `*_utc` / `generated_utc` / `eta_utc` field in the contract is an ISO
// UTC timestamp string. We brand it so callers can't accidentally pass a raw
// `string` where a timestamp is required, while still parsing as a plain
// string at the wire (no format coercion — the pipeline owns the format).
// Times render America/Toronto via the shared time util on the consumer side.
// ---------------------------------------------------------------------------

declare const IsoUtcBrand: unique symbol;

/** A branded ISO-8601 UTC timestamp string (e.g. "2026-06-15T03:14:00Z"). */
export type IsoUtc = string & { readonly [IsoUtcBrand]: true };

/**
 * Zod schema for a wire timestamp. Validates as a non-empty string and brands
 * the output as IsoUtc. We deliberately do NOT enforce a strict ISO regex here:
 * the pipeline is the source of truth for the timestamp format, and an
 * over-strict client check would reject otherwise-good snapshots on a format
 * tweak. Use `$lib/utils/time` to render.
 */
export const isoUtc = (): z.ZodType<IsoUtc> =>
	z
		.string()
		.min(1)
		.transform((s) => s as IsoUtc);

// ---------------------------------------------------------------------------
// Shared structural types.
//
// Hand-written aliases for the two cross-cutting shapes the SHARED CONTRACT
// names directly: `Manifest` (getV1Context().manifest) and `Labels`
// (Record<string,string>, getV1Context().labels). The runtime Zod schemas live
// in ./manifest and ./labels; these aliases re-export the inferred types under
// the contract names so consumers import a stable name.
// ---------------------------------------------------------------------------

export type { Manifest } from './manifest';
export type { Labels } from './labels';
