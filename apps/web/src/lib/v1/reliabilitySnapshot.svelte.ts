import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import {
	getRouteReliability,
	getRouteReliabilityIndex,
	getStopReliability,
} from './repositories/historic';
import { getRoutesIndex } from './repositories/static';
import type { ReliabilityPeriod, RouteReliability } from './schemas/route_reliability';
import type { StopReliability, StopReliabilityPeriod } from './schemas/stop_reliability';
import { otpVerdict } from './reliabilityVerdict';
import type { StatusCode } from './schemas/types';

export type ReliabilityKind = 'route' | 'stop';

export type ReliabilityPhase = 'idle' | 'loading' | 'ready' | 'empty';

export interface ReliabilitySnapshot {
	readonly phase: ReliabilityPhase;
	readonly otpPct: number | null;
	readonly verdict: StatusCode | null;
	readonly series: Array<number | null>;
}

const MAX_IN_FLIGHT = 4;

const SERIES_LEN = 14;

const EMPTY_SNAPSHOT: ReliabilitySnapshot = {
	phase: 'idle',
	otpPct: null,
	verdict: null,
	series: [],
};

const NO_DATA_SNAPSHOT: ReliabilitySnapshot = {
	phase: 'empty',
	otpPct: null,
	verdict: null,
	series: [],
};

type PeriodLike = Pick<ReliabilityPeriod | StopReliabilityPeriod, 'grain' | 'otp_pct'>;

function summarize(
	periods: readonly PeriodLike[] | undefined,
	dateOf?: (p: PeriodLike) => string | null | undefined,
): ReliabilitySnapshot {
	const days = (periods ?? []).filter((p) => p.grain === 'day');
	if (days.length === 0) return NO_DATA_SNAPSHOT;

	const ordered = dateOf
		? [...days].sort((a, b) => String(dateOf(a) ?? '').localeCompare(String(dateOf(b) ?? '')))
		: days;

	const tail = ordered.slice(-SERIES_LEN);
	const series = tail.map((p) => (p.otp_pct == null ? null : p.otp_pct));

	let otpPct: number | null = null;
	for (let i = ordered.length - 1; i >= 0; i--) {
		if (ordered[i].otp_pct != null) {
			otpPct = ordered[i].otp_pct as number;
			break;
		}
	}

	if (otpPct == null) return { phase: 'empty', otpPct: null, verdict: null, series };
	return { phase: 'ready', otpPct, verdict: otpVerdict(otpPct), series };
}

function summarizeRoute(file: RouteReliability | null): ReliabilitySnapshot {
	if (!file) return NO_DATA_SNAPSHOT;
	return summarize(file.periods, (p) => (p as ReliabilityPeriod).date);
}

function summarizeStop(file: StopReliability | null): ReliabilitySnapshot {
	if (!file) return NO_DATA_SNAPSHOT;
	return summarize(file.periods);
}

export type ReliabilityTarget = string | { id: string; known?: boolean | null };

function targetId(target: ReliabilityTarget): string {
	return typeof target === 'string' ? target : target.id;
}

function targetKnown(target: ReliabilityTarget): boolean | undefined {
	if (typeof target === 'string') return undefined;
	if (target.known === null) return false;
	return target.known;
}

export interface ReliabilityLoader {
	get(id: string): ReliabilitySnapshot;
	request(target: ReliabilityTarget): void;
	reliability: (node: Element, target: ReliabilityTarget) => { destroy(): void };
	readonly inFlight: number;
}

export function createReliabilityLoader(kind: ReliabilityKind): ReliabilityLoader {
	const cache = new SvelteMap<string, ReliabilitySnapshot>();
	let inFlight = $state(0);
	const queue: string[] = [];
	const started = new SvelteSet<string>();

	const fetcher = kind === 'route' ? getRouteReliability : getStopReliability;
	const summarizeFor = kind === 'route' ? summarizeRoute : summarizeStop;

	const usesIndex = kind === 'route';
	let indexFlags: SvelteMap<string, boolean> | null = null;
	let indexLoad: Promise<void> | null = null;
	let indexIsMembership = false;
	const pendingUndecided: string[] = [];

	function loadIndexOnce(): Promise<void> {
		if (indexLoad) return indexLoad;
		indexLoad = getRouteReliabilityIndex()
			.then(async (ids) => {
				if (ids) {
					const flags = new SvelteMap<string, boolean>();
					for (const id of ids) flags.set(id, true);
					indexFlags = flags;
					indexIsMembership = true;
					return;
				}
				const idx = await getRoutesIndex();
				const flags = new SvelteMap<string, boolean>();
				for (const r of idx.routes) {
					if (typeof r.reliability === 'boolean') flags.set(r.id, r.reliability);
				}
				indexFlags = flags;
				indexIsMembership = false;
			})
			.catch(() => {
				indexFlags = new SvelteMap<string, boolean>();
				indexIsMembership = false;
			})
			.finally(() => {
				const parked = pendingUndecided.splice(0);
				for (const id of parked) decideWithIndex(id);
			});
		return indexLoad;
	}

	function decideWithIndex(id: string): void {
		const flag = indexFlags?.get(id);
		if (indexIsMembership) {
			if (flag === true) {
				queue.push(id);
				pump();
			} else {
				set(id, NO_DATA_SNAPSHOT);
			}
			return;
		}
		if (flag === false) {
			set(id, NO_DATA_SNAPSHOT);
			return;
		}
		queue.push(id);
		pump();
	}

	function set(id: string, snap: ReliabilitySnapshot): void {
		cache.set(id, snap);
	}

	function pump(): void {
		while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
			const id = queue.shift() as string;
			inFlight++;
			set(id, { ...EMPTY_SNAPSHOT, phase: 'loading' });
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			void (fetcher as (x: string) => Promise<any>)(id)
				.then((file) => {
					set(id, summarizeFor(file));
				})
				.catch(() => {
					set(id, NO_DATA_SNAPSHOT);
				})
				.finally(() => {
					inFlight--;
					pump();
				});
		}
	}

	function request(target: ReliabilityTarget): void {
		const id = targetId(target);
		if (!id || started.has(id)) return;
		started.add(id);
		const known = targetKnown(target);
		if (known === false) {
			set(id, NO_DATA_SNAPSHOT);
			return;
		}
		if (known === true) {
			queue.push(id);
			pump();
			return;
		}
		if (!usesIndex) {
			queue.push(id);
			pump();
			return;
		}
		if (indexFlags) {
			decideWithIndex(id);
			return;
		}
		pendingUndecided.push(id);
		void loadIndexOnce();
	}

	function get(id: string): ReliabilitySnapshot {
		return cache.get(id) ?? EMPTY_SNAPSHOT;
	}

	function reliability(node: Element, target: ReliabilityTarget): { destroy(): void } {
		if (typeof IntersectionObserver === 'undefined') {
			request(target);
			return { destroy() {} };
		}
		const io = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						request(target);
						io.disconnect();
						break;
					}
				}
			},
			{ rootMargin: '200px' },
		);
		io.observe(node);
		return {
			destroy() {
				io.disconnect();
			},
		};
	}

	return {
		get,
		request,
		reliability,
		get inFlight() {
			return inFlight;
		},
	};
}
