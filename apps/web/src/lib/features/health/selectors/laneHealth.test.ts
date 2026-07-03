// laneHealth.test.ts — the pipeline-lanes view-model selector.

import { describe, it, expect } from 'vitest';
import { selectLaneRows, type LaneLabels } from './laneHealth';
import type { DataHealth, IsoUtc } from '$lib/v1/schemas';

const iso = (s: string) => s as unknown as IsoUtc;

const labels: LaneLabels = {
	laneLabel: (k) =>
		({ live: 'Live', static: 'Schedule', rollup: 'Rollups', maintenance: 'Maintenance' })[k] ?? k,
	cadence: (k) => `cadence-${k}`,
	gateVerdict: { pass: 'passed', warn: 'warnings', fail: 'blocked', unknown: 'not checked' },
	maintenanceReason: 'no heartbeat',
	maintenanceLabel: 'Maintenance',
	maintenanceCadence: 'weekly',
};

describe('selectLaneRows', () => {
	it('returns [] when the payload is null (legacy publish → section stands down)', () => {
		expect(selectLaneRows(null, labels)).toEqual([]);
		expect(selectLaneRows(undefined, labels)).toEqual([]);
	});

	it('orders lanes live → static → rollup, then appends the MAINTENANCE not-applicable row', () => {
		const dh: DataHealth = {
			generated_utc: iso('2026-07-02T12:00:00Z'),
			// Deliberately OUT of order to prove the canonical ordering.
			lanes: [
				{ lane: 'rollup', last_publish_utc: iso('2026-07-02T07:00:00Z'), age_s: 18000 },
				{ lane: 'live', last_publish_utc: iso('2026-07-02T11:59:00Z'), age_s: 60 },
				{ lane: 'static', last_publish_utc: iso('2026-07-02T06:00:00Z'), age_s: 21600 },
			],
		};
		const rows = selectLaneRows(dh, labels);
		expect(rows.map((r) => r.key)).toEqual(['live', 'static', 'rollup', 'maintenance']);
		// The maintenance row is the honest not-applicable one.
		const maint = rows[3];
		expect(maint.applicable).toBe(false);
		expect(maint.notApplicableReason).toBe('no heartbeat');
		expect(maint.gate).toBeNull();
	});

	it('maps gate verdicts to status aspects (pass→on_time, warn→unknown, fail→late)', () => {
		const dh: DataHealth = {
			generated_utc: iso('2026-07-02T12:00:00Z'),
			lanes: [
				{ lane: 'live', gate: { verdict: 'pass', checks_run: 10, errors: 0, warnings: 0 } },
				{ lane: 'static', gate: { verdict: 'warn', checks_run: 8, errors: 0, warnings: 2 } },
				{ lane: 'rollup', gate: { verdict: 'fail', checks_run: 5, errors: 1, warnings: 0 } },
			],
		};
		const [live, stat, rollup] = selectLaneRows(dh, labels);
		expect(live.gate).toMatchObject({
			aspect: 'on_time',
			label: 'passed',
			checksRun: 10,
			errors: 0,
		});
		expect(stat.gate).toMatchObject({ aspect: 'unknown', label: 'warnings', warnings: 2 });
		expect(rollup.gate).toMatchObject({ aspect: 'late', label: 'blocked', errors: 1 });
	});

	it('renders an honest-NULL gate (null block or unknown verdict → no fabricated pass)', () => {
		const dh: DataHealth = {
			generated_utc: iso('2026-07-02T12:00:00Z'),
			lanes: [
				{ lane: 'live', gate: null }, // predates 0078
				{ lane: 'static', gate: { verdict: null, checks_run: null, errors: null, warnings: null } },
			],
		};
		const [live, stat] = selectLaneRows(dh, labels);
		expect(live.gate).toBeNull();
		// An unknown/null verdict maps to the neutral aspect + the "not checked" word,
		// never an assumed pass.
		expect(stat.gate).toMatchObject({ aspect: 'unknown', label: 'not checked' });
		expect(stat.gate?.checksRun).toBeNull();
	});

	it('carries null file counts / age through (honest absence, never 0)', () => {
		const dh: DataHealth = {
			generated_utc: iso('2026-07-02T12:00:00Z'),
			lanes: [{ lane: 'rollup', last_publish_utc: null, age_s: null, files_total: null }],
		};
		const [rollup] = selectLaneRows(dh, labels);
		expect(rollup.lastPublishUtc).toBeNull();
		expect(rollup.ageS).toBeNull();
		expect(rollup.filesTotal).toBeNull();
	});

	it('is forward-compatible: an unknown lane key still renders (before maintenance)', () => {
		const dh: DataHealth = {
			generated_utc: iso('2026-07-02T12:00:00Z'),
			lanes: [{ lane: 'replay', age_s: 100 }],
		};
		const rows = selectLaneRows(dh, labels);
		expect(rows.map((r) => r.key)).toEqual(['replay', 'maintenance']);
	});
});
