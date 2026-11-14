import type { HistoryRangeResourceState } from './history/rangeResource.svelte';
import type { HistoricAvailabilityIndex, Manifest } from './schemas/index';
import { getHistoricAvailability } from './repositories/historic';
import { createResource } from './resource.svelte';
import { recordStamp, stampText, type RecordStamp } from './stamp';
import { browser } from '$app/env';
import type { Locale } from '#lib/i18n/copy.ts';

let shown: { readonly stamp: RecordStamp } | null = null;
export function showRecord(read: () => RecordStamp): void {
	if (!browser) return;
	const entry = {
		get stamp() {
			return read();
		},
	};
	$effect(() => {
		shown = entry;
		return () => {
			if (shown === entry) shown = null;
		};
	});
}
export function shownRecord(): { readonly stamp: RecordStamp } | null {
	return browser ? shown : null;
}

export function createRecordStamp(
	manifest: () => Manifest | null | undefined,
	fileGeneratedUtc: () => string | null,
	source?: () => {
		readonly rootIndex?: HistoricAvailabilityIndex | null;
		readonly state: HistoryRangeResourceState;
	},
) {
	const history = createResource(
		async (signal) => {
			try {
				return await getHistoricAvailability({ signal, manifest: manifest() ?? undefined });
			} catch {
				return null;
			}
		},
		{ enabled: () => source === undefined && manifest() != null, key: () => manifest()?.provider },
	);
	const shared = $derived(source?.());
	const stamp = $derived(
		recordStamp({
			manifest: manifest() ?? null,
			historyIndex: manifest() ? (shared ? (shared.rootIndex ?? null) : history.data) : null,
			fileGeneratedUtc: fileGeneratedUtc(),
		}),
	);
	showRecord(() => stamp);
	return {
		get pending() {
			return (
				manifest() != null &&
				(shared
					? ['idle', 'loading-index'].includes(shared.state)
					: history.loading || !history.settled)
			);
		},
		meta(locale: Locale) {
			const text = stampText(stamp, locale, manifest()?.tz);
			return text ? { text, datetime: stamp.publishedOn ?? undefined } : null;
		},
	};
}
