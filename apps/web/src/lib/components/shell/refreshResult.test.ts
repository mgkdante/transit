import { afterEach, expect, it, vi } from 'vitest';
import { refreshMessage, refreshResult } from './refreshResult';
import type { RecordStamp } from '#lib/v1/stamp.ts';

const atMs = Date.parse('2026-11-14T00:21:00Z');
const shownAtMs = Date.parse('2026-11-14T00:09:00Z');
const zone = 'America/Toronto';
const record = (publishedOn: string | null, dataThrough: string | null): RecordStamp => ({
	form: 'record',
	scope: 'window',
	publishedOn,
	dataThrough,
	nextUpdateUtc: null,
	warning: false,
});
afterEach(() => vi.useRealTimers());
it('says when live data was updated', () => {
	const result = refreshResult({ ok: true, atMs, shownAtMs, record: null });
	expect(refreshMessage(result, 'en', zone)).toBe('Live data updated at 7:21 p.m.');
	expect(refreshMessage(result, 'fr', zone)).toBe('Données en direct mises à jour à 19 h 21.');
});
it('says the record has not changed on a record page', () => {
	vi.useFakeTimers();
	vi.setSystemTime(atMs);
	const stamp = record('2026-11-11', '2026-11-10');
	const result = refreshResult({
		ok: true,
		atMs,
		shownAtMs,
		record: { before: stamp, after: stamp },
	});
	expect(refreshMessage(result, 'en', zone)).toBe(
		'Live data updated at 7:21 p.m. The record has not changed since Nov 11.',
	);
	expect(refreshMessage(result, 'fr', zone)).toBe(
		'Données en direct mises à jour à 19 h 21. Le bilan n’a pas changé depuis le 11 nov.',
	);
});
it.each(['publishedOn', 'dataThrough'] as const)(
	'announces a new record with its data-through date (%s)',
	(key) => {
		vi.useFakeTimers();
		vi.setSystemTime(atMs);
		const after = record('2026-11-18', '2026-11-17');
		const result = refreshResult({
			ok: true,
			atMs,
			shownAtMs,
			record: { before: { ...after, [key]: '2026-11-11' }, after },
		});
		expect(refreshMessage(result, 'en', zone)).toBe(
			'Updated. A new record is published: data through Nov 17.',
		);
		expect(refreshMessage(result, 'fr', zone)).toBe(
			'Mise à jour terminée. Un nouveau bilan est publié : données jusqu’au 17 nov.',
		);
	},
);
it('says it could not refresh and names the time of the data still shown', () => {
	const result = refreshResult({ ok: false, atMs, shownAtMs, record: null });
	expect(refreshMessage(result, 'en', zone)).toBe('Could not refresh. Showing data from 7:09 p.m.');
	expect(refreshMessage(result, 'fr', zone)).toBe(
		'Actualisation impossible. Données affichées : 19 h 09.',
	);
});
it('falls back to the live sentence when a new record has no data-through date', () => {
	expect(
		refreshResult({
			ok: true,
			atMs,
			shownAtMs,
			record: {
				before: record('2026-11-11', null),
				after: record('2026-11-18', null),
			},
		}).kind,
	).toBe('updated');
});
it('falls back to the live sentence when the shown record has no publication date', () => {
	expect(
		refreshResult({
			ok: true,
			atMs,
			shownAtMs,
			record: {
				before: record(null, '2026-11-10'),
				after: record(null, '2026-11-17'),
			},
		}).kind,
	).toBe('updated');
});
it('never calls a record new when the earlier date was unknown', () => {
	expect(
		refreshResult({
			ok: true,
			atMs,
			shownAtMs,
			record: {
				before: record(null, null),
				after: record('2026-11-18', '2026-11-17'),
			},
		}).kind,
	).toBe('record-unchanged');
});
it('prints the time in the network’s time zone', () => {
	const summer = { kind: 'updated', atMs: Date.parse('2026-07-14T23:21:00Z') } as const;
	expect(refreshMessage(summer, 'en', 'America/Vancouver')).toBe('Live data updated at 4:21 p.m.');
});
