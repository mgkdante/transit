import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RecordStamp } from '#lib/v1/stamp.ts';
import { healthSummary } from './healthSummary';

const record: RecordStamp = {
	form: 'record',
	scope: 'window',
	dataThrough: '2026-11-10',
	publishedOn: '2026-11-11',
	nextUpdateUtc: null,
	warning: false,
};
const facts = { live: null, record, gate: null, gaps: [] };
const tz = 'America/Toronto';
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

it.each([
	[
		{ ageSeconds: 20, isStale: false },
		'Up to date: live vehicle data, updated 20 seconds ago.',
		'À jour : les données en direct des véhicules, mises à jour il y a 20 secondes.',
	],
	[
		{ ageSeconds: 360, isStale: true },
		'Not current: live vehicle data, last updated 6 minutes ago.',
		'Pas à jour : les données en direct des véhicules, dernière mise à jour il y a 6 minutes.',
	],
	[
		{ ageSeconds: null, isStale: true },
		'Live · update time unknown',
		'En direct · heure de mise à jour inconnue',
	],
])('line 1 says how old live vehicle data is (%o)', (live, en, fr) => {
	expect(healthSummary({ ...facts, live }, 'en', tz).live).toBe(en);
	expect(healthSummary({ ...facts, live }, 'fr', tz).live).toBe(fr);
});

it('says nothing about live data before it has loaded', () => {
	expect(healthSummary(facts, 'en', tz).live).toBeNull();
});

it('line 2 says what the record covers, when it was published and, once published, its next update', () => {
	const line = (stamp: Partial<RecordStamp>, locale: 'en' | 'fr' = 'en') =>
		healthSummary({ ...facts, record: { ...record, ...stamp } }, locale, tz).record;
	expect(line({})).toBe(
		'The reliability record covers service through Nov 10. It was published on Nov 11.',
	);
	expect(line({}, 'fr')).toBe(
		'Le bilan de fiabilité couvre le service jusqu’au 10 nov. Il a été publié le 11 nov.',
	);
	expect(line({ nextUpdateUtc: '2026-11-18T07:00:00Z' })).toMatch(
		/Nov 11\. Next update: Nov 18\.$/,
	);
	expect(line({ nextUpdateUtc: '2026-11-18T07:00:00Z' }, 'fr')).toMatch(
		/11 nov\. Prochaine mise à jour : le 18 nov\.$/,
	);
	expect(line({ dataThrough: null })).toBe('Record · published Nov 11');
	expect(line({ dataThrough: null, publishedOn: null })).toBeNull();
});

it('line 3 says what to doubt, and reassures only when the record passed and live data is current', () => {
	const current = { ageSeconds: 20, isStale: false };
	const pass = { verdict: 'pass' };
	const doubt = (more: Partial<typeof facts> | object, locale: 'en' | 'fr' = 'en') =>
		healthSummary({ ...facts, ...more }, locale, tz).doubt;
	expect(doubt({ live: current, gate: pass })).toBe(
		'Nothing known affects the figures on this site right now.',
	);
	expect(doubt({ live: current, gate: pass }, 'fr')).toBe(
		'Rien de connu n’affecte les chiffres de ce site en ce moment.',
	);
	for (const unsure of [
		{ live: { ageSeconds: 360, isStale: true }, gate: pass },
		{ live: null, gate: pass },
		{ live: current, gate: null },
		{ live: current, gate: { verdict: 'warn', warnings: null } },
	])
		expect(doubt(unsure)).toBeNull();
	expect(doubt({ live: current, gate: { verdict: 'warn', warnings: 1 } })).toBe(
		'The last record was published with 1 warning. Line, stop and ranking figures come from it; check the date beside each figure.',
	);
	expect(doubt({ gate: { verdict: 'warn', warnings: 1 } }, 'fr')).toBe(
		'Le dernier bilan a été publié avec 1 avertissement. Les chiffres des lignes, des arrêts et des classements en proviennent; vérifiez la date à côté de chaque chiffre.',
	);
	expect(doubt({ gate: { verdict: 'warn', warnings: 2 }, gaps: ['metro_realtime'] })).toMatch(
		/with 2 warnings\. .* figure\. Not measured: Metro\. These lines publish no live data\.$/,
	);
	expect(doubt({ gaps: ['otrain_realtime', 'new_gap'] }, 'fr')).toBe(
		'Non mesuré : O-Train, new gap. Ces lignes ne publient aucune donnée en direct.',
	);
});
