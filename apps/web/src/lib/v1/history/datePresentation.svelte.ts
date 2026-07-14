import type { HistoryCorrection } from './selection';
import type { HistoryDateResource } from './dateResource.svelte';

export interface HistoryCorrectionPresentation {
	readonly announcement: string | null;
	readonly revision: number;
	clear(): void;
}

export function createHistoryCorrectionPresentation<TIndex, TValue>(
	resource: HistoryDateResource<TIndex, TValue>,
	messages: () => Readonly<Record<HistoryCorrection['reason'], string>>,
): HistoryCorrectionPresentation {
	let announcement = $state<string | null>(null);
	let handledKey = $state<string | null>(null);
	let revision = $state(0);

	$effect(() => {
		const correction = resource.correction;
		if (correction === null || correction.key === handledKey) return;
		handledKey = correction.key;
		announcement = messages()[correction.reason];
		revision += 1;
	});

	return {
		get announcement() {
			return announcement;
		},
		get revision() {
			return revision;
		},
		clear() {
			announcement = null;
			handledKey = null;
		},
	};
}
