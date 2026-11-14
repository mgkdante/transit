import { afterEach, expect, it, vi } from 'vitest';
import { HistoricAvailabilityIndexSchema, ManifestSchema } from './schemas/index';
import { formatDateKey } from '#lib/utils/time.ts';
import { liveStamp, recordStamp, stampDate, stampText } from './stamp';
import { stampCopy } from './stamp.copy';

const manifest = ManifestSchema.parse({
	attribution: '',
	bbox: [],
	dataset_version: '',
	labels: {},
	surfaces: [],
	provider: 'invented-network',
	display_name: 'Network',
	tz: 'America/Toronto',
	files: {
		live: { generated_utc: '2026-11-11T00:00:00Z' },
		historic: { generated_utc: '2026-11-11T00:00:00Z' },
	},
});
afterEach(() => vi.useRealTimers());
it.each(['en', 'fr'] as const)('prints the publication date as a calendar date in %s', (locale) => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
	const stamp = recordStamp({ manifest, historyIndex: null });
	expect(stampText(stamp, locale, manifest.tz)).toBe(
		stampCopy[locale].record(null, formatDateKey('2026-11-11', locale), 'window'),
	);
});
it('omits the next update when none is published', () => {
	expect(recordStamp({ manifest, historyIndex: null }).nextUpdateUtc).toBeNull();
});
it('omits data through when unknown', () => {
	expect(recordStamp({ manifest, historyIndex: null }).dataThrough).toBeNull();
});
it('says the day for a one-day record', () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
	const stamp = recordStamp({ manifest, historyIndex: null, day: '2026-11-10' });
	expect(stamp.scope).toBe('day');
	expect(stamp.dataThrough).toBe('2026-11-10');
	expect(stampText(stamp, 'en', manifest.tz)).toContain(
		stampCopy.en.record(
			formatDateKey('2026-11-10', 'en'),
			formatDateKey('2026-11-11', 'en'),
			'day',
		),
	);
});
it('uses the published closed window for an unfamiliar network', () => {
	const historyIndex = HistoricAvailabilityIndexSchema.parse({
		generated_utc: manifest.files.live.generated_utc,
		families: [
			{
				family: 'network',
				selection_mode: 'range',
				index_path: 'historic/history/network/index.json',
				last_available_date: '2026-11-10',
			},
		],
	});
	const stamp = recordStamp({ manifest, historyIndex });
	expect(stamp.dataThrough).toBe('2026-11-10');
	expect(stampText(stamp, 'fr', undefined)).toBe(
		stampCopy.fr.record(
			formatDateKey('2026-11-10', 'fr', true),
			formatDateKey('2026-11-11', 'fr', true),
			'window',
		),
	);
});
it('prints nothing when neither date is known', () => {
	const stamp = recordStamp({
		manifest: { ...manifest, files: { live: manifest.files.live } },
		historyIndex: null,
	});
	expect(stampText(stamp, 'en', manifest.tz)).toBe('');
});
it('takes the shown file date before the manifest date', () => {
	expect(
		recordStamp({ manifest, historyIndex: null, fileGeneratedUtc: '2026-11-12T00:00:00Z' })
			.publishedOn,
	).toBe('2026-11-12');
});
it('uses the network time zone to choose the current year', () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2027-01-01T00:30:00Z'));
	const stamp = recordStamp({ manifest, historyIndex: null });
	expect(stampText(stamp, 'en', 'America/Toronto')).toBe(
		stampCopy.en.record(null, formatDateKey('2026-11-11', 'en'), 'window'),
	);
	expect(stampText(stamp, 'en', 'Pacific/Auckland')).toBe(
		stampCopy.en.record(null, formatDateKey('2026-11-11', 'en', true), 'window'),
	);
});

it.each(['en', 'fr'] as const)('uses the network current year for dates in %s', (locale) => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2027-01-01T00:30:00Z'));
	for (const [date, includeYear] of [
		['2026-11-04', false],
		['2025-11-04', true],
	] as const) {
		expect(stampDate(date, locale, manifest.tz)).toBe(formatDateKey(date, locale, includeYear));
	}
});

it.each([
	['en', 'Live · updated 30 seconds ago'],
	['fr', 'En direct · mis à jour il y a 30 secondes'],
] as const)('prints a current live stamp in %s', (locale, text) => {
	expect(stampText(liveStamp({ ageSeconds: 30 }), locale, undefined)).toBe(text);
});

it.each([
	[
		'says live data is not current when it is behind',
		{ ageSeconds: 240, isStale: true },
		'Live · updated 4 minutes ago · not current',
		'En direct · mis à jour il y a 4 minutes · pas à jour',
	],
	[
		'says the update time is unknown',
		{ ageSeconds: null, isStale: true },
		'Live · update time unknown',
		'En direct · heure de mise à jour inconnue',
	],
	[
		'says the feed is not responding',
		{ ageSeconds: null, notResponding: true },
		'Live · not responding',
		'En direct · ne répond pas',
	],
	[
		'names alerts as the subject',
		{ ageSeconds: 720, subject: 'alerts' },
		'Live alerts · updated 12 minutes ago',
		'Avis en direct · mis à jour il y a 12 minutes',
	],
	[
		'keeps a relative age past one day',
		{ ageSeconds: 172800 },
		'Live · updated 2 days ago',
		'En direct · mis à jour avant-hier',
	],
] as const)('%s', (_name, input, en, fr) => {
	expect(stampText(liveStamp(input), 'en', undefined)).toBe(en);
	expect(stampText(liveStamp(input), 'fr', undefined)).toBe(fr);
});
it('reads the state from a page presentation', () => {
	for (const [facts, state] of [
		[{ ageSeconds: 30, notResponding: true }, 'not-responding'],
		[{ ageSeconds: null, isStale: true }, 'unknown'],
		[{ ageSeconds: 30, isStale: true }, 'behind'],
		[{ ageSeconds: 30, degraded: true }, 'current'],
	] as const)
		expect(liveStamp({ ...facts }).state).toBe(state);
});
