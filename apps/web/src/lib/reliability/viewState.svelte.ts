import { untrack } from 'svelte';
import { SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity';
import { page } from '$app/state';
import { fromSearchParams, resolveWindow, type DateWindow } from '$lib/filters';
import type { Locale } from '$lib/i18n';
import { absenceSentence } from '$lib/site/absence';
import { mirrorSearchParams } from '$lib/site/urlMirror';
import { formatDateKey } from '$lib/utils/time';
import type { GrainSegment } from '$lib/components/surface/GrainPicker.svelte';
import type {
	HistoryNavigatorLabels,
	HistoryNavigatorProps,
} from '$lib/components/surface/HistoryNavigator.svelte';
import type { HistoricCollectionIndex } from '$lib/v1/schemas/history';
import {
	availabilityFromCollectionIndex,
	datesForAvailability,
	type HistoryCorrection,
} from '$lib/v1/history/selection';
import {
	historyRangeRequestFromSearchParams,
	type HistoryRangeResource,
	type RawHistoryRangeRequest,
} from '$lib/v1/history/rangeResource.svelte';
import { presentGrains, type ReliabilityGrainSnapshot } from './grains';

interface Snapshot extends ReliabilityGrainSnapshot {
	readonly by_grain?: readonly unknown[];
	readonly periods?: readonly { readonly grain: string; readonly date?: string | null }[] | null;
	readonly daily?: readonly { readonly date: string }[] | null;
}

interface HistoryCopy {
	readonly navigator: HistoryNavigatorLabels;
	readonly coverage: (from: string, to: string) => string;
	readonly selection: (from: string, to: string) => string;
	readonly correction: Readonly<Record<HistoryCorrection['reason'], string>>;
	readonly loading?: string;
	readonly partial?: string;
	readonly noData?: string;
	readonly error?: string;
	readonly ready?: string;
}

interface ViewOptions<
	S extends Snapshot | null | undefined,
	R,
	K extends string,
	D extends Snapshot | null | undefined,
> {
	readonly snapshot: () => S;
	readonly retained?: {
		readonly resource: () => HistoryRangeResource<HistoricCollectionIndex, R> | null | undefined;
		readonly copy: () => HistoryCopy;
		readonly window?: () => DateWindow | null | undefined;
	};
	readonly grains: {
		readonly keys: readonly [K, ...K[]];
		readonly labels: () => Partial<Record<K, string | { label: string; compactLabel: string }>>;
		readonly present?: () => ReadonlySet<K>;
	};
	readonly apply?: (snapshot: S, retained: R | null) => D;
	readonly locale: () => Locale;
	/** Additional owned parameters, or false when the caller disables URL synchronization. */
	readonly url?: () => Readonly<Record<string, string | null>> | false;
}

const emptyRequest = (): RawHistoryRangeRequest => ({
	hasFrom: false,
	hasTo: false,
	rawFrom: null,
	rawTo: null,
});

export function createReliabilityViewState<
	S extends Snapshot | null | undefined,
	R = never,
	K extends string = 'day' | 'week' | 'month',
	D extends Snapshot | null | undefined = S,
>(options: ViewOptions<S, R, K, D>) {
	const params = new SvelteURLSearchParams(untrack(() => page.url.searchParams));
	const seed = fromSearchParams(params);
	// A line's range is a separate view choice; stop/network keep grain and dates independent.
	const rangeChoice = options.grains.keys.find((key) => key === 'range');
	const firstGrain = options.grains.keys[0];
	// Hotspots' exact shift token is an extension to the shared calendar parser.
	const seededGrain =
		options.grains.keys.some((key) => key === 'shift') && params.get('grain') === 'shift'
			? 'shift'
			: seed.grain;
	const explicitRangeToken = rangeChoice != null && params.get('grain') === rangeChoice;
	const initialRequest =
		rangeChoice == null ? emptyRequest() : historyRangeRequestFromSearchParams(params);
	let localRequest = $state.raw(initialRequest);
	let selected = $state(
		options.retained != null &&
			options.grains.keys.some((key) => key !== 'range' && key === params.get('grain')),
	);
	let grain = $state<K>(
		rangeChoice != null && (explicitRangeToken || initialRequest.hasFrom || initialRequest.hasTo)
			? rangeChoice
			: (options.grains.keys.find((key) => key === seededGrain) ?? firstGrain),
	);
	let correctionText = $state<string | null>(null);
	let handledCorrection = '';
	let initialized = false;
	const snapshot = $derived(options.snapshot());
	const resource = $derived(options.retained?.resource() ?? null);
	const copy = $derived(options.retained?.copy());
	const request = $derived(resource?.request ?? localRequest);
	const requested = $derived(request.hasFrom || request.hasTo);
	const active = $derived(resource != null && requested && resource.state !== 'current');
	const ready = $derived(resource?.state === 'ready' || resource?.state === 'partial');
	const retainedValue = $derived(ready ? (resource?.value ?? null) : null);
	const data = $derived(
		active && options.apply ? options.apply(snapshot, retainedValue) : snapshot,
	);
	// Local fallback uses stop daily rows or dated line windows. Network's rolling chart
	// series is deliberately not a current-snapshot date navigator.
	const currentDates = $derived(
		[
			...new SvelteSet(
				snapshot?.daily?.map((day) => day.date) ??
					snapshot?.periods?.flatMap((window) =>
						window.grain === 'day' && window.date ? [window.date] : [],
					) ??
					[],
			),
		].sort(),
	);
	const availableDates = $derived.by(() => {
		const retained =
			resource?.index == null
				? []
				: datesForAvailability(availabilityFromCollectionIndex(resource.index));
		return retained.length > 0 ? retained : currentDates;
	});
	const requestWindow = $derived.by<DateWindow | undefined>(() => {
		const { hasFrom, hasTo, rawFrom, rawTo } = request;
		if (
			!hasFrom ||
			!hasTo ||
			rawFrom == null ||
			rawTo == null ||
			(rangeChoice != null && (!rawFrom || !rawTo))
		)
			return undefined;
		return rawFrom <= rawTo ? { from: rawFrom, to: rawTo } : { from: rawTo, to: rawFrom };
	});
	const currentWindow = $derived(
		resource != null && requested && resource.state === 'current' && resource.index == null
			? (resolveWindow(requestWindow, new SvelteSet(currentDates)) ?? undefined)
			: undefined,
	);
	const selectedWindow = $derived(
		rangeChoice != null
			? requestWindow
			: active
				? (resource?.resolved?.selection ?? undefined)
				: currentWindow,
	);
	const windowOverride = $derived(options.retained?.window?.());
	const window = $derived(windowOverride !== undefined ? windowOverride : selectedWindow);
	// Leaving a line range switches back to its snapshot, so its choices use that snapshot.
	const available = $derived<ReadonlySet<string>>(
		options.grains.present?.() ?? presentGrains(rangeChoice == null ? data : snapshot),
	);
	const segments = $derived<GrainSegment<K>[]>(
		options.grains.keys.map((key) => {
			const text: string | { label: string; compactLabel: string } =
				options.grains.labels()[key] ?? key;
			const enabled = key === rangeChoice ? availableDates.length > 0 : available.has(key);
			return {
				key,
				...(typeof text === 'string' ? { label: text } : text),
				available: enabled,
				...(enabled ? {} : { title: absenceSentence('no-observations', options.locale()) }),
			};
		}),
	);

	function setRequest(next: RawHistoryRangeRequest): void {
		if (resource == null) localRequest = { ...next };
		else resource.setRequest(next);
	}
	function selectGrain(key: string): void {
		const next = options.grains.keys.find((candidate) => candidate === key);
		if (next === undefined) return;
		grain = next;
		selected = options.retained != null && next !== rangeChoice;
		if (rangeChoice != null && next !== rangeChoice) setRequest(emptyRequest());
	}
	function selectWindow(value: DateWindow | undefined): void {
		correctionText = null;
		handledCorrection = '';
		setRequest(
			value == null
				? emptyRequest()
				: { hasFrom: true, hasTo: true, rawFrom: value.from, rawTo: value.to },
		);
	}

	$effect(() => {
		const correction = resource?.resolved?.correction;
		if (!correction || correction.key === handledCorrection) return;
		handledCorrection = correction.key;
		correctionText = copy?.correction[correction.reason] ?? null;
		setRequest(emptyRequest());
		if (rangeChoice != null && !explicitRangeToken) {
			grain = firstGrain;
			selected = false;
		}
	});
	$effect(() => {
		if (!initialized) {
			initialized = true;
			if (rangeChoice != null && resource == null) {
				const local = resolveWindow(seed.window, new SvelteSet(currentDates));
				selectWindow(local ?? undefined);
				if (local) grain = rangeChoice;
				else if (grain === rangeChoice && !explicitRangeToken) grain = firstGrain;
				if (grain === rangeChoice && availableDates.length === 0) grain = firstGrain;
			}
			if (
				rangeChoice != null &&
				!selected &&
				(grain === 'week' || grain === 'month') &&
				!available.has(grain)
			)
				grain = firstGrain;
		}
		if (
			rangeChoice == null &&
			(!selected || options.retained == null) &&
			available.size > 0 &&
			!available.has(grain)
		)
			grain = options.grains.keys.find((key) => available.has(key)) ?? firstGrain;
	});
	$effect(() => {
		if (rangeChoice == null || !requested) return;
		if (grain !== rangeChoice) {
			setRequest(emptyRequest());
			return;
		}
		if (
			resource != null &&
			resource.state === 'current' &&
			resource.index == null &&
			resolveWindow(requestWindow, new SvelteSet(currentDates)) == null
		) {
			setRequest(emptyRequest());
			if (!explicitRangeToken) grain = firstGrain;
		}
	});
	$effect(() => {
		const extra = options.url?.() ?? {};
		if (extra === false) return;
		const grainParam =
			options.retained == null
				? grain === firstGrain
					? null
					: grain
				: grain === rangeChoice
					? requestWindow == null
						? rangeChoice
						: null
					: selected
						? grain
						: null;
		if (
			options.retained == null ||
			(rangeChoice == null && (resource == null || windowOverride !== undefined))
		) {
			mirrorSearchParams({ grain: grainParam, ...extra });
			return;
		}
		const canonical =
			rangeChoice != null ? requestWindow : (resource?.resolved?.canonicalWindow ?? currentWindow);
		const pending = rangeChoice == null && active && resource?.resolved == null;
		mirrorSearchParams({
			grain: grainParam,
			from: canonical?.from ?? (pending && request.hasFrom ? request.rawFrom : null),
			to: canonical?.to ?? (pending && request.hasTo ? request.rawTo : null),
			...extra,
		});
	});

	const coverageText = $derived.by(() => {
		if (!resource?.index || !copy) return null;
		const coverage = availabilityFromCollectionIndex(resource.index);
		return coverage.kind === 'continuous'
			? copy.coverage(
					formatDateKey(coverage.firstDate, options.locale()),
					formatDateKey(coverage.lastDate, options.locale()),
				)
			: null;
	});
	const selectionText = $derived(
		selectedWindow && copy
			? copy.selection(
					formatDateKey(selectedWindow.from, options.locale()),
					formatDateKey(selectedWindow.to, options.locale()),
				)
			: null,
	);
	const liveAnnouncement = $derived.by(() => {
		if (correctionText != null) return correctionText;
		if (!active || !copy) return '';
		switch (resource?.state) {
			case 'loading-index':
			case 'loading-range':
				return copy.loading ?? '';
			case 'partial':
				return copy.partial ?? '';
			case 'no-data':
				return copy.noData ?? '';
			case 'error':
				return copy.error ?? '';
			case 'ready':
				return copy.ready ?? '';
			default:
				return '';
		}
	});

	return {
		get data() {
			return data;
		},
		get grain() {
			return grain;
		},
		get segments() {
			return segments;
		},
		selectGrain,
		get window() {
			return window;
		},
		get verdictWindow() {
			return {
				grain: selected ? grain : undefined,
				...(window ? { from: window.from, to: window.to } : {}),
			};
		},
		get history() {
			return {
				active,
				ready,
				value: retainedValue,
				state: resource?.state ?? 'current',
				discovered: resource?.index != null,
				retry: () => resource?.retry(),
			};
		},
		get navigator(): HistoryNavigatorProps | null {
			return copy
				? {
						mode: 'range',
						locale: options.locale(),
						labels: copy.navigator,
						availableDates,
						value: selectedWindow,
						coverageText,
						selectionText,
						liveAnnouncement: false,
						onRangeChange: selectWindow,
					}
				: null;
		},
		get announcements() {
			return { correction: correctionText, live: liveAnnouncement };
		},
	};
}
