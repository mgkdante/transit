import { afterEach, expect, it, vi } from 'vitest';
import { HistoricAvailabilityIndexSchema, ManifestSchema } from './schemas/index';
import { formatDateKey } from '#lib/utils/time.ts';
import { recordStamp, stampDate, stampText } from './stamp';
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
