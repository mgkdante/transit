// laneHealth — pure view-models for the /status "Pipeline lanes" section.
//
// data_health.json carries the three lanes that HAVE a Postgres publish heartbeat
// (live / static / historic-labelled-'rollup', from core.snapshot_publish_state).
// This selector turns each into a render-ready row: a localized label, a cadence
// line, humanized last-publish age INPUTS (the actual humanization + relative-age
// math stays in the component via the shared time/freshness utils), file counts,
// and a gate chip mapped to a dataviz status tone. It also appends the MAINTENANCE
// honest-NOT-APPLICABLE row built entirely from STATIC copy — the maintenance
// stage runs only in CI and writes NO DB heartbeat, so there is nothing to
// fabricate; the row states that plainly.
//
// i18n stays OUT: the caller passes already-localized labels/cadence copy. Honesty
// throughout: a null age/count/gate stays null so the component renders the styled
// absence, never a fabricated 0 or an assumed pass.

import type { DataHealth, LaneHealth } from '$lib/v1/schemas';

/** Dataviz status aspect a lane's gate verdict maps to (chip tone). */
export type GateAspect = 'on_time' | 'late' | 'unknown';

/** One lane's gate summary, ready to render as a chip (null → no gate outcome). */
export interface GateView {
	/** 'on_time' (pass) | 'late' (fail) | 'unknown' (warn / unrecognized). */
	readonly aspect: GateAspect;
	/** Already-localized verdict word (e.g. "passed" / "warnings" / "blocked"). */
	readonly label: string;
	/** Raw counts, each null when the outcome predates 0078 / the gate was off. */
	readonly checksRun: number | null;
	readonly errors: number | null;
	readonly warnings: number | null;
}

/** A pipeline-lane row. `applicable=false` is the MAINTENANCE not-applicable row. */
export interface LaneRow {
	readonly key: string;
	/** Localized lane label (e.g. "Live", "Schedule", "Rollups", "Maintenance"). */
	readonly label: string;
	/** Localized scheduled-cadence line (e.g. "every ~57s", "daily 06:00 UTC"). */
	readonly cadence: string;
	/** Whether this lane has a DB heartbeat. false → the not-applicable row. */
	readonly applicable: boolean;
	/** ISO last-publish stamp, null when the lane has never published / N/A. */
	readonly lastPublishUtc: string | null;
	/** Server-computed age in seconds, null when unknown / N/A. */
	readonly ageS: number | null;
	readonly filesWritten: number | null;
	readonly filesSkipped: number | null;
	readonly filesTotal: number | null;
	/** Gate chip, or null when this lane has no gate outcome / is N/A. */
	readonly gate: GateView | null;
	/** For the N/A row only: the localized reason there is no heartbeat. */
	readonly notApplicableReason: string | null;
}

/** Already-localized labels the selector interpolates (i18n stays at the call site). */
export interface LaneLabels {
	/** lane key ('live'|'static'|'rollup'|'maintenance') → localized label. */
	readonly laneLabel: (key: string) => string;
	/** lane key → localized scheduled-cadence line. */
	readonly cadence: (key: string) => string;
	/** Gate verdict words, keyed by tone. */
	readonly gateVerdict: {
		readonly pass: string;
		readonly warn: string;
		readonly fail: string;
		readonly unknown: string;
	};
	/** The MAINTENANCE row's not-applicable reason line. */
	readonly maintenanceReason: string;
	/** The MAINTENANCE row's label + cadence (it is not in the payload). */
	readonly maintenanceLabel: string;
	readonly maintenanceCadence: string;
}

/**
 * Map a persisted gate verdict string ('pass'|'warn'|'fail') to a chip view. An
 * unknown/absent verdict → the neutral aspect + the "unknown" word (never a
 * fabricated pass). Counts stay null when the payload omitted them.
 */
function gateViewOf(gate: LaneHealth['gate'], labels: LaneLabels): GateView | null {
	if (gate == null) return null;
	const verdict = gate.verdict;
	let aspect: GateAspect;
	let label: string;
	switch (verdict) {
		case 'pass':
			aspect = 'on_time';
			label = labels.gateVerdict.pass;
			break;
		case 'fail':
			aspect = 'late';
			label = labels.gateVerdict.fail;
			break;
		case 'warn':
			aspect = 'unknown';
			label = labels.gateVerdict.warn;
			break;
		default:
			aspect = 'unknown';
			label = labels.gateVerdict.unknown;
	}
	return {
		aspect,
		label,
		checksRun: gate.checks_run ?? null,
		errors: gate.errors ?? null,
		warnings: gate.warnings ?? null,
	};
}

/** One payload lane → a render-ready row. */
function laneRowOf(lane: LaneHealth, labels: LaneLabels): LaneRow {
	return {
		key: lane.lane,
		label: labels.laneLabel(lane.lane),
		cadence: labels.cadence(lane.lane),
		applicable: true,
		lastPublishUtc: lane.last_publish_utc ?? null,
		ageS: lane.age_s ?? null,
		filesWritten: lane.files_written ?? null,
		filesSkipped: lane.files_skipped ?? null,
		filesTotal: lane.files_total ?? null,
		gate: gateViewOf(lane.gate, labels),
		notApplicableReason: null,
	};
}

/** The MAINTENANCE honest not-applicable row, built entirely from static copy. */
function maintenanceRow(labels: LaneLabels): LaneRow {
	return {
		key: 'maintenance',
		label: labels.maintenanceLabel,
		cadence: labels.maintenanceCadence,
		applicable: false,
		lastPublishUtc: null,
		ageS: null,
		filesWritten: null,
		filesSkipped: null,
		filesTotal: null,
		gate: null,
		notApplicableReason: labels.maintenanceReason,
	};
}

/**
 * Build the full lane-row list from the payload: one row per published lane (in a
 * stable live → static → rollup order, matching the pipeline's tier order) + the
 * MAINTENANCE not-applicable row last. Any lane the payload OMITS is simply absent
 * (honest — we never synthesize a heartbeat for a missing tier).
 */
const LANE_ORDER: readonly string[] = ['live', 'static', 'rollup'];

export function selectLaneRows(dh: DataHealth | null | undefined, labels: LaneLabels): LaneRow[] {
	if (dh == null) return [];
	const lanes = dh.lanes ?? [];
	const byKey = new Map(lanes.map((l) => [l.lane, l]));
	const ordered: LaneRow[] = [];
	// Emit known lanes in the canonical order first.
	for (const key of LANE_ORDER) {
		const lane = byKey.get(key);
		if (lane) ordered.push(laneRowOf(lane, labels));
	}
	// Then any lane the payload carried that is NOT in the canonical order (forward-
	// compatible: a new heartbeat tier renders without a code change).
	for (const lane of lanes) {
		if (!LANE_ORDER.includes(lane.lane)) ordered.push(laneRowOf(lane, labels));
	}
	// The MAINTENANCE not-applicable row always closes the list.
	ordered.push(maintenanceRow(labels));
	return ordered;
}
