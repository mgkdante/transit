import type { DataHealth, LaneHealth } from '$lib/v1/schemas';

export type GateAspect = 'on_time' | 'late' | 'unknown';

export interface GateView {
	readonly aspect: GateAspect;
	readonly label: string;
	readonly checksRun: number | null;
	readonly errors: number | null;
	readonly warnings: number | null;
}

export interface LaneRow {
	readonly key: string;
	readonly label: string;
	readonly cadence: string;
	readonly applicable: boolean;
	readonly lastPublishUtc: string | null;
	readonly ageS: number | null;
	readonly filesWritten: number | null;
	readonly filesSkipped: number | null;
	readonly filesTotal: number | null;
	readonly gate: GateView | null;
	readonly notApplicableReason: string | null;
}

export interface LaneLabels {
	readonly laneLabel: (key: string) => string;
	readonly cadence: (key: string) => string;
	readonly gateVerdict: {
		readonly pass: string;
		readonly warn: string;
		readonly fail: string;
		readonly unknown: string;
	};
	readonly maintenanceReason: string;
	readonly maintenanceLabel: string;
	readonly maintenanceCadence: string;
}

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

const LANE_ORDER: readonly string[] = ['live', 'static', 'rollup'];

export function selectLaneRows(dh: DataHealth | null | undefined, labels: LaneLabels): LaneRow[] {
	if (dh == null) return [];
	const lanes = dh.lanes ?? [];
	const byKey = new Map(lanes.map((l) => [l.lane, l]));
	const ordered: LaneRow[] = [];
	for (const key of LANE_ORDER) {
		const lane = byKey.get(key);
		if (lane) ordered.push(laneRowOf(lane, labels));
	}
	for (const lane of lanes) {
		if (!LANE_ORDER.includes(lane.lane)) ordered.push(laneRowOf(lane, labels));
	}
	ordered.push(maintenanceRow(labels));
	return ordered;
}
