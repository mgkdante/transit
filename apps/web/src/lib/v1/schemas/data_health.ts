// data_health.ts — Zod mirror of live_data_health.schema.json (title: "DataHealth").
// status/data_health.json is the per-lane publish-freshness + last-gate-outcome
// summary the LIVE lane serves every cycle, so /status can render "how healthy is
// the pipeline right now" from ONE fetch (no scraping the CI gate artifact).
//
// lanes carries EXACTLY the three lanes that have a Postgres publish heartbeat
// (live / static / historic-labelled-'rollup', from core.snapshot_publish_state).
// MAINTENANCE + REPLAY are DELIBERATELY ABSENT (no DB heartbeat exists) — the web
// renders them as honest not-applicable rows from static copy, never from this
// payload. Each lane's gate block is honest-NULL when the lane predates migration
// 0078 or was published with the gate disabled (verdict UNKNOWN, never assumed
// pass). Honesty rule: every additive field the contract allows to be null is
// .nullable() here; we surface "no data" rather than coercing to zero.

import { z } from 'zod';
import { isoUtc, payloadEnvelopeFields } from './types';

// Last VALUE-GATE outcome for a lane (counts + verdict only — the full results[]
// stays a CI artifact). Every field honest-NULL when the outcome is unknown.
export const DataHealthGateSchema = z.object({
	checks_run: z.number().int().nullable().optional(),
	errors: z.number().int().nullable().optional(),
	warnings: z.number().int().nullable().optional(),
	// 'pass' | 'warn' | 'fail' — the contract keeps the string open, so we keep it
	// a free string here and map to a status tone at the selector (unknown verdict
	// → the neutral aspect, never a fabricated pass).
	verdict: z.string().nullable().optional(),
	generated_utc: isoUtc().nullable().optional(),
});
export type DataHealthGate = z.infer<typeof DataHealthGateSchema>;

// One publish lane's last-completed-publish health. `lane` is the citizen label
// ('live' | 'static' | 'rollup'); every other field is honest-NULL when the lane
// has never published (last_publish_utc/age_s) or the count is absent.
export const LaneHealthSchema = z.object({
	lane: z.string(),
	last_publish_utc: isoUtc().nullable().optional(),
	age_s: z.number().int().nullable().optional(),
	files_written: z.number().int().nullable().optional(),
	files_skipped: z.number().int().nullable().optional(),
	files_total: z.number().int().nullable().optional(),
	gate: DataHealthGateSchema.nullable().optional(),
});
export type LaneHealth = z.infer<typeof LaneHealthSchema>;

// Per-feed freshness, mirroring ProvenanceFreshness (same source: the live lane's
// feed detail is one fetch). `feed` is the only required field.
export const DataHealthFeedSchema = z.object({
	feed: z.string(),
	status: z.string().nullable().optional(),
	age_s: z.number().int().nullable().optional(),
});
export type DataHealthFeed = z.infer<typeof DataHealthFeedSchema>;

export const DataHealthSchema = z.object({
	generated_utc: isoUtc(),
	lanes: z.array(LaneHealthSchema).optional(),
	feeds: z.array(DataHealthFeedSchema).optional(),
	...payloadEnvelopeFields(),
});
export type DataHealth = z.infer<typeof DataHealthSchema>;
