import type { Manifest } from './schemas/index';
import { getHistoricAvailability } from './repositories/historic';
import { createResource } from './resource.svelte';
import { recordStamp, stampText } from './stamp';
import type { Locale } from '#lib/i18n/copy.ts';

export function createRecordStamp(
	manifest: () => Manifest | null | undefined,
	fileGeneratedUtc: () => string | null,
) {
	const history = createResource(
		async (signal) => {
			try {
				return await getHistoricAvailability({ signal, manifest: manifest() ?? undefined });
			} catch {
				return null;
			}
		},
		{ enabled: () => manifest() != null, key: () => manifest()?.provider },
	);
	const stamp = $derived(
		recordStamp({
			manifest: manifest() ?? null,
			historyIndex: manifest() ? history.data : null,
			fileGeneratedUtc: fileGeneratedUtc(),
		}),
	);
	return {
		get pending() {
			return manifest() != null && (history.loading || !history.settled);
		},
		meta(locale: Locale) {
			const text = stampText(stamp, locale, manifest()?.tz);
			return text ? { text, datetime: stamp.publishedOn ?? undefined } : null;
		},
	};
}
