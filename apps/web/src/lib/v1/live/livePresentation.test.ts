import { describe, expect, it } from 'vitest';
import {
	livePresentation,
	publicationPresentation,
	type LivePresentationInput,
} from './livePresentation';
import type { FeedHealth, LiveFamilyState } from './store.svelte';
import { copy as mapCopy } from '#lib/features/map/map.copy.ts';
import { tripCopy } from '#lib/features/trips/trips.copy.ts';
import { formatUtc } from '#lib/utils/time.ts';

const timestamp = '2026-06-21T12:00:00Z';

it('keeps the map counter on vehicles while preserving selected trip-feed failure notices', () => {
	const result = present(
		{
			vehicles: family(),
			trips: family({
				ageSeconds: 3600,
				ageSource: 'serving-capture',
				ageTimestamp: '2026-06-21T11:00:00Z',
				state: 'retained-stale',
				isStale: true,
				notice: 'refresh-unavailable',
			}),
		},
		{ page: 'map', selection: { kind: 'vehicle' } },
	);
	expect(result.stamp).toMatchObject({ ageSeconds: 20, generatedUtc: timestamp });
	expect(result.notice.kind).toBe('refresh-unavailable');
});
function family(health: Partial<FeedHealth> = {}, active = true): LiveFamilyState {
	return {
		active,
		phase: 'ready',
		lastGoodAt: null,
		retainedGeneration: timestamp,
		error: null,
		successRevision: 1,
		health: {
			state: 'live',
			retained: true,
			ageSeconds: 20,
			ageSource: 'publication',
			ageTimestamp: timestamp,
			isStale: false,
			notice: null,
			...health,
		},
	};
}
const stale = () =>
	family({ state: 'retained-stale', ageSeconds: 300, isStale: true, notice: 'stale' });
const unloaded = () => ({
	...family({
		state: 'never-loaded',
		retained: false,
		ageSeconds: null,
		ageSource: null,
		ageTimestamp: null,
	}),
	retainedGeneration: null,
});
const failed = () => ({
	...unloaded(),
	health: {
		...unloaded().health,
		state: 'failed-no-data' as const,
		isStale: true,
		notice: 'refresh-unavailable' as const,
	},
});
function present(
	familyStates: LivePresentationInput['familyStates'],
	options: Partial<LivePresentationInput> = {},
) {
	return livePresentation({
		familyStates,
		families: ['vehicles', 'trips', 'departures', 'network', 'alerts'],
		locale: 'en',
		page: 'map',
		...options,
	});
}

describe.each(['en', 'fr'] as const)('Live notice in %s', (locale) => {
	it('has nothing to report for live data, stale alerts, or alerts alone', () => {
		for (const familyStates of [
			{ vehicles: family() },
			{ vehicles: family(), alerts: stale() },
			{ alerts: stale() },
		]) {
			const result = present(familyStates, { locale });
			expect(result.notice).toMatchObject({ kind: 'none', message: '', tone: 'neutral' });
			expect(result.stamp.isStale).toBe(false);
		}
	});
	it('does not let unshown or inactive families affect the page', () => {
		expect(
			present({ vehicles: family(), trips: stale() }, { locale, families: ['vehicles'] }).notice
				.kind,
		).toBe('none');
		expect(
			present({ vehicles: family(), trips: { ...stale(), active: false } }, { locale }).notice.kind,
		).toBe('none');
	});
	it('ignores trip notices outside the shown active families', () => {
		expect(
			present({ trips: stale() }, { locale, page: 'trip', families: ['vehicles'] }).notice.kind,
		).toBe('none');
		expect(
			present({ trips: { ...stale(), active: false } }, { locale, page: 'trip' }).notice.kind,
		).toBe('none');
	});
	it('keeps selected failures first, including a failed first load and competing failures', () => {
		const vehicles = failed();
		const trips = family({ state: 'retrying', notice: 'refresh-unavailable' });
		const selected = present({ vehicles, trips }, { locale, selection: { kind: 'vehicle' } });
		expect(selected.notice.message).toBe(
			mapCopy[locale].selectedFamilyFailure(mapCopy[locale].familyVehicles, false),
		);
		expect(selected.bannerState).toBe('selected-family-failure');
	});
	it('keeps a retry without retained data unknown without announcing a whole-feed stall', () => {
		const vehicles = {
			...unloaded(),
			health: {
				...unloaded().health,
				state: 'retrying' as const,
				notice: 'refresh-unavailable' as const,
			},
		};
		const result = present({ vehicles }, { locale });
		expect(result.notice.kind).toBe('none');
		expect(result.stamp).toMatchObject({ ageSeconds: null, isStale: false, degraded: true });
	});
	it('treats never-loaded families as unknown, without announcing an outage', () => {
		const result = present({ vehicles: unloaded(), alerts: stale() }, { locale });
		expect(result.notice.kind).toBe('none');
		expect(result.stamp).toMatchObject({
			ageSeconds: null,
			ageSource: null,
			isStale: false,
			ageText: locale === 'en' ? 'unknown' : 'inconnu',
		});
	});
	it('uses partial-stall wording when another family is fresh or never loaded', () => {
		for (const trips of [family(), unloaded()]) {
			const result = present({ vehicles: stale(), trips }, { locale });
			expect(result.notice).toMatchObject({
				kind: 'partial-stall',
				message: mapCopy[locale].feedAgeUnknown,
				tone: 'warning',
			});
			expect(result.bannerState).toBe('partial-stall');
		}
	});
	it('reports a whole-feed stall with known or unknown age', () => {
		const known = present({ vehicles: stale() }, { locale });
		expect(known.notice.kind).toBe('whole-feed-stall');
		expect(known.notice.message).toContain(locale === 'en' ? '5 minutes ago' : 'il y a 5 minutes');
		expect(known.stamp.ageText).toBe(mapCopy[locale].feedNotRespondingShort);
		const unknown = present({ vehicles: family({ ageSeconds: null, isStale: true }) }, { locale });
		expect(unknown.notice.message).toBe(mapCopy[locale].feedAgeUnknown);
	});
	it('keeps unavailable ahead of unknown age, and identifies an empty fresh vehicle report', () => {
		expect(present({ vehicles: failed() }, { locale }).notice).toMatchObject({
			kind: 'unavailable',
			message: mapCopy[locale].liveUnavailable,
		});
		expect(present({ vehicles: family() }, { locale, vehicleCount: 0 }).notice).toMatchObject({
			kind: 'no-vehicles',
			message: mapCopy[locale].liveNoVehicles,
		});
		expect(present({ vehicles: stale() }, { locale, vehicleCount: 0 }).notice.kind).toBe(
			'whole-feed-stall',
		);
	});
	it('retains selection failure precedence and candidate order while retrying', () => {
		const retry = family({ state: 'retrying', notice: 'refresh-unavailable', ageSeconds: null });
		for (const [kind, familyName] of [
			['vehicle', 'trips'],
			['stop', 'departures'],
			['route', 'alerts'],
		] as const) {
			const result = present(
				{ vehicles: stale(), [familyName]: retry },
				{ locale, selection: { kind } },
			);
			expect(result.notice.kind).toBe('refresh-unavailable');
			expect(result.bannerState).toBe('selected-family-failure');
			expect(result.notice.message).toBe(
				mapCopy[locale].selectedFamilyFailure(
					kind === 'vehicle'
						? mapCopy[locale].familyTrips
						: kind === 'stop'
							? mapCopy[locale].familyDepartures
							: mapCopy[locale].familyAlerts,
					true,
				),
			);
			expect(result.stamp.degraded).toBe(true);
		}
	});
	it('keeps the trip report-behind and refresh-unavailable messages and retained body', () => {
		for (const notice of ['stale', 'refresh-unavailable'] as const) {
			const result = present(
				{ trips: family({ notice, isStale: true }) },
				{ locale, page: 'trip' },
			);
			expect(result.notice).toMatchObject({
				kind: notice === 'stale' ? 'report-behind' : 'refresh-unavailable',
				message:
					notice === 'stale' ? tripCopy[locale].reportBehind : tripCopy[locale].refreshUnavailable,
				body: tripCopy[locale].retainedReport,
				tone: 'warning',
			});
		}
	});
});

it('selects Live age and its timestamp from the oldest shown non-alert family', () => {
	const capture = '2026-06-20T10:00:00Z';
	const result = present(
		{
			vehicles: family(),
			trips: family({ ageSeconds: 93600, ageSource: 'serving-capture', ageTimestamp: capture }),
			alerts: family({ ageSeconds: 999999 }),
		},
		{ page: 'trip' },
	);
	expect(result.stamp).toMatchObject({
		ageSeconds: 93600,
		ageSource: 'serving-capture',
		generatedUtc: capture,
	});
	expect(present({ vehicles: family() }).stamp.ageSource).toBe('publication');
});

it.each(['en', 'fr'] as const)('prints the age source timestamp after 24 hours in %s', (locale) => {
	const capture = '2026-06-20T10:00:00Z';
	const result = present(
		{ trips: family({ ageSeconds: 93600, ageSource: 'serving-capture', ageTimestamp: capture }) },
		{ page: 'trip', locale },
	);
	expect(result.stamp.ageText).toBe(
		formatUtc(capture, locale, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZoneName: 'short',
		}),
	);
	expect(result.stamp.generatedUtc).toBe(capture);
	expect(result.publicationUtc).toBe(timestamp);
});

it('propagates unknown age instead of recomputing from a valid publication', () => {
	const result = present(
		{ vehicles: family(), trips: family({ ageSeconds: null }) },
		{ page: 'trip' },
	);
	expect(result.stamp.ageSeconds).toBeNull();
	expect(result.stamp.ageText).toBe('unknown');
});

it('formats historic publication ages outside the rendering components', () => {
	expect(publicationPresentation(timestamp, Date.parse(timestamp) + 120000, 'en').ageText).toBe(
		'2 minutes ago',
	);
	expect(publicationPresentation('2099-01-01T00:00:00Z', Date.parse(timestamp), 'fr').ageText).toBe(
		'inconnu',
	);
});

it.each(['en', 'fr'] as const)(
	'ages the published network feed-age note through the same interface in %s',
	(locale) => {
		const options = { page: 'network' as const, locale, networkFeedAgeAtPublication: 100 };
		expect(present({ network: family({ ageSeconds: 20 }) }, options).networkFeedAgeText).toBe(
			locale === 'en' ? '2 minutes ago' : 'il y a 2 minutes',
		);
		expect(
			present({ network: family({ ageSeconds: null }) }, options).networkFeedAgeText,
		).toBeNull();
		expect(
			present({ network: family() }, { ...options, networkFeedAgeAtPublication: null })
				.networkFeedAgeText,
		).toBeNull();
	},
);
