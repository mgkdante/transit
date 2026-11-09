import { describe, it, expect } from 'vitest';
import { liveAbsenceReason, describeAbsence, absenceSentence } from './absence';
import type { FeedHealthState } from '#lib/v1/live/store.svelte.ts';
const fields = [
	'position',
	'vehicle-delay',
	'occupancy',
	'next-stop',
	'vehicle-route',
	'vehicle-trip',
	'trip-delay',
	'trip-route',
	'prediction',
	'prediction-delay',
	'trip-prediction',
	'trip-prediction-delay',
] as const;
const states: FeedHealthState[] = [
	'live',
	'retained-stale',
	'retrying',
	'failed-no-data',
	'never-loaded',
];
describe('live absence reasons', () => {
	for (const field of fields)
		for (const state of states)
			for (const silent of [false, true])
				for (const locale of ['en', 'fr'] as const) {
					it(field + ' ' + state + ' notReporting=' + silent + ' ' + locale, () => {
						const health = { state };
						const reason = liveAbsenceReason(field, {
							familyStates: { vehicles: { health }, trips: { health }, departures: { health } },
							notReporting: silent,
						});
						const expected =
							state === 'retained-stale'
								? 'report-behind'
								: state === 'retrying' || state === 'failed-no-data'
									? 'refresh-unavailable'
									: state === 'never-loaded'
										? 'not-loaded'
										: silent
											? 'not-reporting'
											: field === 'prediction' || field === 'trip-prediction'
												? 'no-prediction'
												: 'not-reported';
						expect(reason).toBe(expected);
						expect(describeAbsence(reason, locale).why).toBeTruthy();
					});
				}
	it('uses only the owning family', () => {
		const familyStates = {
			vehicles: { health: { state: 'live' as const } },
			trips: { health: { state: 'retained-stale' as const } },
		};
		expect(liveAbsenceReason('occupancy', { familyStates })).toBe('not-reported');
		expect(liveAbsenceReason('trip-delay', { familyStates })).toBe('report-behind');
	});
	it('keeps unsupported and schedule absence distinct', () => {
		expect(liveAbsenceReason('position', { unsupported: true, notReporting: true })).toBe(
			'metro-no-realtime',
		);
		expect(liveAbsenceReason('next-stop', { scheduleMissing: true })).toBe('not-in-schedule');
	});
	it('preserves historical sentences', () => {
		expect(absenceSentence('no-observations', 'en')).toBe('No data · not enough readings yet');
		expect(absenceSentence('no-observations', 'fr')).toBe('Aucune donnée · pas assez de mesures');
	});
});
