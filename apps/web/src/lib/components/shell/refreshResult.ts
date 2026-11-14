import type { Locale } from '#lib/i18n/copy.ts';
import { stampDate, type RecordStamp } from '#lib/v1/stamp.ts';
import { refreshCopy } from './refresh.copy';

export type RefreshResult =
	| { readonly kind: 'updated'; readonly atMs: number }
	| { readonly kind: 'record-unchanged'; readonly atMs: number; readonly publishedOn: string }
	| { readonly kind: 'record-new'; readonly dataThrough: string }
	| { readonly kind: 'failed'; readonly shownAtMs: number };
export const RESULT_VISIBLE_MS = 8_000;
export function refreshResult(input: {
	readonly ok: boolean;
	readonly atMs: number;
	readonly shownAtMs: number;
	readonly record: { readonly before: RecordStamp; readonly after: RecordStamp } | null;
}): RefreshResult {
	const { ok, atMs, shownAtMs, record } = input;
	if (!ok) return { kind: 'failed', shownAtMs };
	if (record?.after.publishedOn) {
		const { before, after } = record;
		const changed = (['publishedOn', 'dataThrough'] as const).some(
			(key) => before[key] != null && after[key] != null && before[key] !== after[key],
		);
		if (changed && after.dataThrough) return { kind: 'record-new', dataThrough: after.dataThrough };
		if (!changed && after.publishedOn)
			return { kind: 'record-unchanged', atMs, publishedOn: after.publishedOn };
	}
	return { kind: 'updated', atMs };
}
export function refreshMessage(
	result: RefreshResult,
	locale: Locale,
	timeZone: string | undefined,
): string {
	const copy = refreshCopy[locale];
	const time = (ms: number) =>
		new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone,
		}).format(new Date(ms));
	switch (result.kind) {
		case 'updated':
			return copy.updated(time(result.atMs));
		case 'record-unchanged':
			return copy.recordUnchanged(
				time(result.atMs),
				stampDate(result.publishedOn, locale, timeZone),
			);
		case 'record-new':
			return copy.recordNew(stampDate(result.dataThrough, locale, timeZone));
		case 'failed':
			return copy.failed(time(result.shownAtMs));
	}
}
