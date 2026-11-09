import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AlertsFileSchema, TripsFileSchema, StopDeparturesFileSchema } from './index';

describe('feed capture rollout compatibility', () => {
	for (const [family, schema, body] of [
		['live_alerts', AlertsFileSchema, { alerts: [] }],
		['live_trips', TripsFileSchema, { trips: {} }],
		['live_stop_departures', StopDeparturesFileSchema, { stops: {} }],
	] as const) {
		it(`${family} accepts old snapshots and preserves new timestamps or explicit unknown`, () => {
			const old = { generated_utc: '2026-11-04T12:00:00Z', ...body };
			expect(schema.parse(old)).not.toHaveProperty('feed_captured_utc');
			for (const capture of [null, '2026-11-04T11:59:00Z']) {
				expect(schema.parse({ ...old, feed_captured_utc: capture })).toHaveProperty(
					'feed_captured_utc',
					capture,
				);
			}
			const mirror = JSON.parse(
				readFileSync(new URL(`./json/${family}.schema.json`, import.meta.url), 'utf8'),
			);
			expect(mirror.required).not.toContain('feed_captured_utc');
			expect(mirror.properties.feed_captured_utc.anyOf).toEqual([
				{ type: 'string' },
				{ type: 'null' },
			]);
			expect(schema.safeParse({ ...old, feed_captured_utc: 42 }).success).toBe(false);
		});
	}
});
