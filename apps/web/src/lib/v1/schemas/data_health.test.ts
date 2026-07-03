// data_health.test.ts — additive-contract gate for the S11 DataHealth payload +
// the manifest data_health pointer.
//
// The payload is additive: a LEGACY manifest (no live.data_health pointer) must
// still validate, and a LEGACY publish (no data_health.json) resolves to null at
// the adapter (covered by the adapter's 404-as-null contract). Here we prove the
// Zod facts directly: minimal + full parse, honest-NULL gate blocks survive, the
// envelope fields are optional, and the legacy manifest without the pointer parses.

import { describe, it, expect } from 'vitest';
import { DataHealthSchema, DataHealthGateSchema, LaneHealthSchema } from './data_health';
import { ManifestSchema } from './manifest';

const ISO = '2026-07-02T12:00:00Z';

describe('DataHealthSchema — minimal + additive', () => {
	it('parses the minimal payload (generated_utc only); lanes/feeds default to []', () => {
		const parsed = DataHealthSchema.parse({ generated_utc: ISO });
		expect(parsed.generated_utc).toBe(ISO);
		// Optional arrays are absent (not defaulted by Zod), which the selector treats
		// as an empty lane/feed list — the section stands down honestly.
		expect(parsed.lanes ?? []).toEqual([]);
		expect(parsed.feeds ?? []).toEqual([]);
	});

	it('parses a full payload with three lanes, a gated lane, and feeds', () => {
		const parsed = DataHealthSchema.parse({
			generated_utc: ISO,
			schema_version: 1,
			methodology_version: 'live-1',
			publish_generation_id: 'gen-abc123',
			lanes: [
				{
					lane: 'live',
					last_publish_utc: ISO,
					age_s: 57,
					files_written: 5,
					files_skipped: 0,
					files_total: 5,
					gate: { checks_run: 42, errors: 0, warnings: 1, verdict: 'warn', generated_utc: ISO },
				},
				{ lane: 'static', last_publish_utc: ISO, age_s: 3600, files_total: 120 },
				{ lane: 'rollup', last_publish_utc: ISO, age_s: 7200 },
			],
			feeds: [{ feed: 'realtime_vehicles', status: 'succeeded', age_s: 40 }],
		});
		expect(parsed.lanes).toHaveLength(3);
		expect(parsed.lanes?.[0].gate?.verdict).toBe('warn');
		expect(parsed.feeds?.[0].feed).toBe('realtime_vehicles');
	});

	it('accepts an honest-NULL gate block (lane predates 0078 / gate disabled)', () => {
		// A lane with a null gate AND a gate whose every field is null both parse — the
		// gate outcome is UNKNOWN, never coerced to a fabricated pass.
		expect(() =>
			LaneHealthSchema.parse({ lane: 'live', last_publish_utc: ISO, age_s: 12, gate: null }),
		).not.toThrow();
		const g = DataHealthGateSchema.parse({
			checks_run: null,
			errors: null,
			warnings: null,
			verdict: null,
			generated_utc: null,
		});
		expect(g.verdict).toBeNull();
	});

	it('accepts a lane that has never published (last_publish_utc + age_s null)', () => {
		const lane = LaneHealthSchema.parse({ lane: 'rollup', last_publish_utc: null, age_s: null });
		expect(lane.last_publish_utc).toBeNull();
		expect(lane.age_s).toBeNull();
	});
});

describe('Manifest.data_health pointer — additive-optional', () => {
	const base = {
		provider: 'stm',
		display_name: 'Société de transport de Montréal',
		bbox: [-73.97, 45.4, -73.47, 45.7],
		attribution: 'STM',
		dataset_version: '2026.07.02',
		labels: { on_time: 'On time' },
		surfaces: ['data-trust'],
	};

	it('a LEGACY manifest with NO live.data_health pointer still validates', () => {
		const parsed = ManifestSchema.parse({ ...base, files: { live: { generated_utc: ISO } } });
		expect(parsed.files.live.data_health).toBeUndefined();
	});

	it('validates a manifest that DOES carry the pointer', () => {
		const parsed = ManifestSchema.parse({
			...base,
			files: { live: { generated_utc: ISO, data_health: 'status/data_health.json' } },
		});
		expect(parsed.files.live.data_health).toBe('status/data_health.json');
	});
});
