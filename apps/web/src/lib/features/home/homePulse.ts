import type { NetworkFile } from '#lib/v1/schemas/network.ts';
import type { HotspotEntry, Hotspots } from '#lib/v1/schemas/generated/historic_hotspots.ts';
import { stopDisplayName } from '#lib/site/transitDisplay.ts';
import type { LineDirectory } from '#lib/site/lineDirectory.ts';

/** What the network is doing right now, read from the live network snapshot. */
export interface LivePulse {
	readonly inService: number;
	readonly onTimePct: number | null;
	/** Buses more than five minutes late; null when no bus has a delay reading. */
	readonly severeLate: number | null;
	/** Buses in service with a known delay reading (the late count's denominator). */
	readonly withReading: number;
	/** Buses more than one minute early, which can leave riders behind. */
	readonly early: number | null;
	readonly notReporting: number;
}

export function selectLivePulse(net: NetworkFile | null): LivePulse | null {
	if (!net) return null;
	const withReading = net.vehicles_in_service - net.status_dist.unknown;
	return {
		inService: net.vehicles_in_service,
		onTimePct: net.on_time_pct,
		severeLate: withReading > 0 ? net.status_dist.severe : null,
		withReading,
		early: withReading > 0 ? net.status_dist.early : null,
		notReporting: net.non_responding,
	};
}

export interface PulseRank {
	readonly kind: 'line' | 'stop';
	readonly id: string;
	/** Complete visible line label, or the stop's name. */
	readonly label: string;
	readonly spoken?: string;
	readonly severePct: number | null;
}

export interface WorstPulse {
	/** Last day the ranking window covers. */
	readonly through: string | null;
	readonly lines: readonly PulseRank[];
	readonly stops: readonly PulseRank[];
}

function kindOf(type: string): PulseRank['kind'] | null {
	const kind = type.toLowerCase();
	if (kind === 'route' || kind === 'line') return 'line';
	if (kind === 'stop') return 'stop';
	return null;
}

function toRank(entry: HotspotEntry, kind: PulseRank['kind'], directory: LineDirectory) {
	const name = entry.name ?? null;
	const line = kind === 'line' ? directory.name(entry.id, name) : null;
	return line
		? {
				kind,
				id: entry.id,
				label: line.label,
				spoken: line.spoken,
				severePct: entry.severe_pct ?? null,
			}
		: {
				kind,
				id: entry.id,
				label: name ? stopDisplayName(name) : entry.id,
				severePct: entry.severe_pct ?? null,
			};
}

/**
 * The worst lines and stops over a published window, ranked like the hotspots page.
 * The week is the default: the record is republished weekly, so a single day can be stale.
 */
export function selectWorst(
	hotspots: Hotspots | null,
	directory: LineDirectory,
	{ grain = 'week', limit = 5 }: { grain?: string; limit?: number } = {},
): WorstPulse | null {
	const window = hotspots?.by_grain?.find((entry) => entry.grain === grain);
	if (!window) return null;
	const ranked = [...(window.entries ?? [])].sort(
		(a, b) => (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY),
	);
	const pick = (kind: PulseRank['kind']) => {
		// A published file is outside input: a repeated id must not reach a keyed list.
		const seen = new Set<string>();
		return ranked
			.filter((entry) => kindOf(entry.type) === kind && !seen.has(entry.id) && seen.add(entry.id))
			.slice(0, limit)
			.map((entry) => toRank(entry, kind, directory));
	};
	return {
		through: window.window_end ?? window.date ?? null,
		lines: pick('line'),
		stops: pick('stop'),
	};
}
