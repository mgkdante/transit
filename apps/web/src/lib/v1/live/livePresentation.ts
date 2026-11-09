import type { Locale } from '#lib/i18n/index.ts';
import { formatRelativeSeconds, formatUtc } from '#lib/utils/time.ts';
import { freshnessAgeSeconds } from '#lib/v1/freshness.ts';
import { copy as mapCopy } from '#lib/features/map/map.copy.ts';
import { tripCopy } from '#lib/features/trips/trips.copy.ts';
import { networkReliabilityCopy } from '#lib/features/network/reliability/network-reliability.copy.ts';
import type { LiveFamily, LiveFamilyState } from './store.svelte';

export type LiveAgeSource = 'publication' | 'serving-capture';
export type LiveNoticeKind =
	| 'none'
	| 'report-behind'
	| 'refresh-unavailable'
	| 'partial-stall'
	| 'whole-feed-stall'
	| 'unavailable'
	| 'no-vehicles';
export type MapNoticeState =
	| 'idle'
	| 'selected-family-failure'
	| 'partial-stall'
	| 'global-stall'
	| 'unavailable'
	| 'no-vehicles';

export interface StampPresentation {
	readonly generatedUtc: string | null;
	readonly ageSeconds: number | null;
	readonly ageSource: LiveAgeSource | null;
	readonly ageText: string;
	readonly isStale: boolean;
	readonly degraded: boolean;
	readonly label?: string;
	readonly ageLabel?: string | null;
	readonly visible: boolean;
}

type Family = Pick<LiveFamilyState, 'active' | 'retainedGeneration' | 'health'>;
export interface LivePresentationInput {
	readonly familyStates: Readonly<Partial<Record<LiveFamily, Family>>>;
	readonly families: readonly LiveFamily[];
	readonly locale: Locale;
	readonly page?: 'map' | 'trip' | 'network';
	readonly selection?: { readonly kind: 'vehicle' | 'stop' | 'route' | 'route-line' } | null;
	readonly vehicleCount?: number | null;
	readonly networkFeedAgeAtPublication?: number | null;
}

export interface LivePresentation {
	readonly stamp: StampPresentation;
	readonly publicationUtc: string | null;
	readonly networkFeedAgeText: string | null;
	readonly notice: {
		readonly kind: LiveNoticeKind;
		readonly message: string;
		readonly body: string;
		readonly tone: 'neutral' | 'warning';
	};
	readonly bannerState: MapNoticeState;
	readonly isPartialStale: boolean;
}

/** Formatting also serves historic publication stamps; components only render it. */
export function stampAgeText(age: number | null, timestamp: string | null, locale: Locale): string {
	if (age == null) return locale === 'fr' ? 'inconnu' : 'unknown';
	if (age >= 86_400 && timestamp)
		return formatUtc(timestamp, locale, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZoneName: 'short',
		});
	return formatRelativeSeconds(age, locale);
}

export function publicationPresentation(
	generatedUtc: string | null,
	nowMs: number,
	locale: Locale,
): StampPresentation {
	const ageSeconds = freshnessAgeSeconds(generatedUtc, nowMs);
	return {
		generatedUtc,
		ageSeconds,
		ageSource: ageSeconds == null ? null : 'publication',
		ageText: stampAgeText(ageSeconds, generatedUtc, locale),
		isStale: false,
		degraded: false,
		visible: generatedUtc != null || ageSeconds != null,
	};
}

function liveAge(states: readonly Family[], locale: Locale): StampPresentation {
	const loaded = states.filter(
		({ health }) => health.retained || health.state === 'failed-no-data',
	);
	const unknown = loaded.length === 0 || loaded.some(({ health }) => health.ageSeconds == null);
	const oldest = loaded.reduce<Family | null>(
		(prior, next) =>
			prior == null || (next.health.ageSeconds ?? 0) > (prior.health.ageSeconds ?? 0)
				? next
				: prior,
		null,
	);
	const ageSeconds = unknown ? null : oldest!.health.ageSeconds;
	// Health owns the clock and future tolerance. Never infer age from a timestamp here.
	const generatedUtc = unknown
		? oldestPublication(states)
		: (oldest!.health.ageTimestamp ?? oldest!.retainedGeneration);
	return {
		generatedUtc,
		ageSeconds,
		ageSource: unknown ? null : (oldest!.health.ageSource ?? 'publication'),
		ageText: stampAgeText(ageSeconds, generatedUtc, locale),
		isStale: states.some(({ health }) => health.isStale),
		degraded: false,
		visible: generatedUtc != null || ageSeconds != null,
	};
}

export function feedPresentation(state: Family, locale: Locale): StampPresentation {
	return { ...liveAge([state], locale), degraded: state.health.notice === 'refresh-unavailable' };
}

function selectedFailure(input: LivePresentationInput): string | null {
	if (!input.selection) return null;
	const t = mapCopy[input.locale];
	const families: readonly LiveFamily[] =
		input.selection.kind === 'vehicle'
			? ['vehicles', 'trips', 'alerts']
			: input.selection.kind === 'stop'
				? ['departures', 'vehicles', 'alerts']
				: ['vehicles', 'alerts'];
	const labels = {
		vehicles: t.familyVehicles,
		trips: t.familyTrips,
		departures: t.familyDepartures,
		alerts: t.familyAlerts,
		network: '',
	};
	for (const family of families) {
		const state = input.familyStates[family];
		if (
			input.families.includes(family) &&
			state?.active &&
			state.health.notice === 'refresh-unavailable'
		)
			return t.selectedFamilyFailure(labels[family], state.health.retained);
	}
	return null;
}

type NoticeResult = Pick<LivePresentation, 'notice' | 'bannerState'>;
function noticeResult(
	kind: LiveNoticeKind,
	message = '',
	bannerState: MapNoticeState = 'idle',
	body = '',
): NoticeResult {
	return {
		bannerState,
		notice: {
			kind,
			message,
			body,
			tone: kind === 'none' || kind === 'no-vehicles' ? 'neutral' : 'warning',
		},
	};
}

function mapNotice(
	input: LivePresentationInput,
	stamp: StampPresentation,
	partial: boolean,
): NoticeResult {
	const t = mapCopy[input.locale];
	const failure = selectedFailure(input);
	if (failure) return noticeResult('refresh-unavailable', failure, 'selected-family-failure');
	const state = input.familyStates.vehicles;
	const vehicles = input.families.includes('vehicles') && state?.active ? state.health : undefined;
	const unavailable = vehicles?.state === 'failed-no-data';
	if (stamp.ageSeconds == null && unavailable)
		return noticeResult('unavailable', t.liveUnavailable, 'unavailable');
	if (stamp.isStale) {
		const message =
			partial || stamp.ageSeconds == null
				? t.feedAgeUnknown
				: t.feedNotResponding(formatRelativeSeconds(stamp.ageSeconds, input.locale));
		return noticeResult(
			partial ? 'partial-stall' : 'whole-feed-stall',
			message,
			partial ? 'partial-stall' : 'global-stall',
		);
	}
	if (unavailable) return noticeResult('unavailable', t.liveUnavailable, 'unavailable');
	if (vehicles?.retained && !vehicles.isStale && input.vehicleCount === 0)
		return noticeResult('no-vehicles', t.liveNoVehicles, 'no-vehicles');
	return noticeResult('none');
}

function mapStamp(
	stamp: StampPresentation,
	result: NoticeResult,
	locale: Locale,
	degraded: boolean,
): StampPresentation {
	const ageLabel =
		result.bannerState === 'global-stall' && stamp.ageSeconds != null
			? mapCopy[locale].feedNotRespondingShort
			: null;
	return {
		...stamp,
		degraded,
		ageLabel,
		label: ageLabel ? undefined : mapCopy[locale].latestReport,
		ageText: ageLabel ?? stamp.ageText,
		visible: stamp.visible || ageLabel != null,
	};
}

function tripPresentation(input: LivePresentationInput, stamp: StampPresentation) {
	const state = input.familyStates.trips;
	const health = input.families.includes('trips') && state?.active ? state.health : undefined;
	const t = tripCopy[input.locale];
	const failed = health?.notice === 'refresh-unavailable';
	const result = health?.notice
		? noticeResult(
				failed ? 'refresh-unavailable' : 'report-behind',
				failed ? t.refreshUnavailable : t.reportBehind,
				'idle',
				t.retainedReport,
			)
		: noticeResult('none');
	return { stamp: { ...stamp, degraded: failed, label: t.latestReport }, ...result };
}

function oldestPublication(states: readonly Family[]): string | null {
	return (
		states
			.map((state) => state.retainedGeneration)
			.filter((value): value is string => value != null && Number.isFinite(Date.parse(value)))
			.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null
	);
}

function networkFeedAgeText(input: LivePresentationInput): string | null {
	const state = input.familyStates.network;
	const publishedAge = input.networkFeedAgeAtPublication;
	const snapshotAge = state?.health.ageSeconds;
	if (
		!input.families.includes('network') ||
		!state?.active ||
		publishedAge == null ||
		snapshotAge == null
	)
		return null;
	return formatRelativeSeconds(publishedAge + snapshotAge, input.locale);
}

/** One decision boundary for what a page says about the feed families it shows. */
export function livePresentation(input: LivePresentationInput): LivePresentation {
	const states = input.families.flatMap((family) => {
		const state = input.familyStates[family];
		return state?.active ? [{ family, ...state }] : [];
	});
	const headline = states.filter(({ family }) => family !== 'alerts');
	const stamp = liveAge(headline, input.locale);
	const isPartialStale = stamp.isStale && headline.some(({ health }) => !health.isStale);
	const degraded = states.some(({ health }) => health.notice === 'refresh-unavailable');
	const base = {
		publicationUtc: oldestPublication(headline),
		isPartialStale,
		networkFeedAgeText: networkFeedAgeText(input),
	};
	if (input.page === 'map') {
		const result = mapNotice(input, stamp, isPartialStale);
		return { ...base, stamp: mapStamp(stamp, result, input.locale, degraded), ...result };
	}
	if (input.page === 'trip') return { ...base, ...tripPresentation(input, stamp) };
	if (input.page === 'network')
		return {
			...base,
			stamp: {
				...stamp,
				degraded,
				label: degraded ? networkReliabilityCopy[input.locale].snapshotRefreshFailed : undefined,
			},
			...noticeResult('none'),
		};
	return { ...base, stamp, ...noticeResult('none') };
}
