<script lang="ts">
	import type { DateWindow } from '$lib/filters';
	import type {
		HistoricCollectionIndex,
		HistoryRangeResource,
		HistoryRangeResourceState,
		RawHistoryRangeRequest,
		ResolvedHistoryRange,
	} from '$lib/v1';
	import { createRetainedHistoryUi } from '../createRetainedHistoryUi.svelte';

	const emptyRequest = (): RawHistoryRangeRequest => ({
		hasFrom: false,
		hasTo: false,
		rawFrom: null,
		rawTo: null,
	});

	let request = $state.raw<RawHistoryRangeRequest>(emptyRequest());
	let index = $state.raw<HistoricCollectionIndex | null>(null);
	let resolved = $state.raw<ResolvedHistoryRange | null>(null);
	let phase = $state<HistoryRangeResourceState>('current');
	let correctionCount = $state(0);

	const resource: HistoryRangeResource<HistoricCollectionIndex, { readonly id: string }> = {
		get request() {
			return request;
		},
		get index() {
			return index;
		},
		get resolved() {
			return resolved;
		},
		get value() {
			return phase === 'ready' ? { id: 'accepted' } : null;
		},
		get state() {
			return phase;
		},
		get error() {
			return null;
		},
		setRequest(next) {
			request = next;
		},
		retry() {},
		destroy() {},
	};

	const ui = createRetainedHistoryUi({
		resource: () => resource,
		currentDates: () => ['2026-01-10', '2026-01-11'],
		copy: () => ({
			coverage: (from, to) => `coverage ${from} ${to}`,
			selection: (from, to) => `selection ${from} ${to}`,
			correction: {
				malformed: 'corrected malformed',
				'outside-coverage': 'corrected outside',
				gap: 'corrected gap',
				unpublished: 'corrected unpublished',
			},
			loading: 'loading range',
			partial: 'partial range',
			noData: 'empty range',
			error: 'failed range',
			ready: 'ready range',
		}),
		formatDate: (date) => `[${date}]`,
		onCorrection: () => {
			correctionCount += 1;
		},
	});

	const wire = $derived(ui.wireWindow());

	function seedRange(): void {
		ui.selectRange({ from: '2026-01-03', to: '2026-01-02' });
		phase = 'loading-index';
	}

	function acceptRange(): void {
		index = {
			generated_utc: '2026-01-03T00:00:00Z',
			family: 'network',
			selection_mode: 'range',
			first_available_date: '2026-01-01',
			last_available_date: '2026-01-03',
			gaps: [],
			partitions: [],
		} as unknown as HistoricCollectionIndex;
		resolved = {
			selection: { from: '2026-01-02', to: '2026-01-03' },
			canonicalWindow: { from: '2026-01-02', to: '2026-01-03' },
			intersectingGaps: [],
			correction: null,
		};
		phase = 'ready';
	}

	function correctRange(): void {
		resolved = {
			selection: null,
			canonicalWindow: null,
			intersectingGaps: [],
			correction: { key: 'history-range:gap:fixture', reason: 'gap' },
		};
		phase = 'current';
	}

	function useFallbackWindow(): void {
		resolved = null;
		phase = 'current';
	}

	const fallbackWindow: DateWindow = { from: '2026-01-10', to: '2026-01-11' };
</script>

<div
	data-testid="retained-history-ui"
	data-requested={String(ui.requested)}
	data-explicit={String(ui.explicit)}
	data-ready={String(ui.ready)}
	data-request-window={ui.requestWindow == null
		? ''
		: `${ui.requestWindow.from}:${ui.requestWindow.to}`}
	data-resolved-window={ui.resolvedWindow == null
		? ''
		: `${ui.resolvedWindow.from}:${ui.resolvedWindow.to}`}
	data-available-dates={ui.availableDates.join(',')}
	data-coverage={ui.coverageText ?? ''}
	data-selection={ui.selectionText(ui.resolvedWindow) ?? ''}
	data-announcement={ui.announcement ?? ''}
	data-live-announcement={ui.liveAnnouncement}
	data-wire-from={wire.from ?? ''}
	data-wire-to={wire.to ?? ''}
	data-fallback-from={ui.wireWindow(fallbackWindow).from ?? ''}
	data-corrections={String(correctionCount)}
></div>

<button type="button" data-testid="seed" onclick={seedRange}>Seed</button>
<button type="button" data-testid="accept" onclick={acceptRange}>Accept</button>
<button type="button" data-testid="correct" onclick={correctRange}>Correct</button>
<button type="button" data-testid="fallback" onclick={useFallbackWindow}>Fallback</button>
