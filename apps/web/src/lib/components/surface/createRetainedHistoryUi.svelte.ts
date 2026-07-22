import type { DateWindow } from '$lib/filters';
import type { HistoricCollectionIndex } from '$lib/v1/schemas/history';
import {
	availabilityFromCollectionIndex,
	datesForAvailability,
	type HistoryCorrection,
} from '$lib/v1/history/selection';
import type {
	HistoryRangeResource,
	RawHistoryRangeRequest,
} from '$lib/v1/history/rangeResource.svelte';

type Resource<TValue> = HistoryRangeResource<HistoricCollectionIndex, TValue>;

interface RetainedHistoryCopy {
	readonly coverage: (from: string, to: string) => string;
	readonly selection: (from: string, to: string) => string;
	readonly correction: Readonly<Record<HistoryCorrection['reason'], string>>;
	readonly loading?: string;
	readonly partial?: string;
	readonly noData?: string;
	readonly error?: string;
	readonly ready?: string;
}

interface RetainedHistoryUiOptions<TValue> {
	readonly resource: () => Resource<TValue> | null | undefined;
	readonly initialRequest?: RawHistoryRangeRequest;
	readonly currentDates?: () => readonly string[];
	readonly copy: () => RetainedHistoryCopy;
	readonly formatDate: (date: string) => string;
	readonly isCompleteRequest?: (request: RawHistoryRangeRequest) => boolean;
	readonly onCorrection?: (correction: HistoryCorrection) => void;
}

const emptyRequest = (): RawHistoryRangeRequest => ({
	hasFrom: false,
	hasTo: false,
	rawFrom: null,
	rawTo: null,
});

function requestWindow(
	request: RawHistoryRangeRequest,
	isCompleteRequest?: (request: RawHistoryRangeRequest) => boolean,
): DateWindow | undefined {
	const { hasFrom, hasTo, rawFrom, rawTo } = request;
	if (
		!hasFrom ||
		!hasTo ||
		rawFrom == null ||
		rawTo == null ||
		isCompleteRequest?.(request) === false
	)
		return undefined;
	return rawFrom <= rawTo ? { from: rawFrom, to: rawTo } : { from: rawTo, to: rawFrom };
}

function stateAnnouncement(resource: Resource<unknown>, copy: RetainedHistoryCopy): string {
	if (resource.state === 'loading-index' || resource.state === 'loading-range') {
		return copy.loading ?? '';
	}
	if (resource.state === 'partial') return copy.partial ?? '';
	if (resource.state === 'no-data') return copy.noData ?? '';
	if (resource.state === 'error') return copy.error ?? '';
	if (resource.state === 'ready') return copy.ready ?? '';
	return '';
}

export function createRetainedHistoryUi<TValue>(options: RetainedHistoryUiOptions<TValue>) {
	let localRequest = $state.raw<RawHistoryRangeRequest>({
		...(options.initialRequest ?? emptyRequest()),
	});
	let announcement = $state<string | null>(null);
	let handledCorrection = '';
	const resource = $derived(options.resource() ?? null);
	const currentRequest = () => resource?.request ?? localRequest;
	const isRequested = () => currentRequest().hasFrom || currentRequest().hasTo;
	const isExplicit = () => resource != null && isRequested() && resource.state !== 'current';

	function setRequest(next: RawHistoryRangeRequest): void {
		if (resource == null) localRequest = { ...next };
		else resource.setRequest(next);
	}

	$effect(() => {
		const correction = resource?.resolved?.correction;
		if (correction == null || correction.key === handledCorrection) return;
		handledCorrection = correction.key;
		announcement = options.copy().correction[correction.reason];
		setRequest(emptyRequest());
		options.onCorrection?.(correction);
	});

	return {
		get requested() {
			return isRequested();
		},
		get explicit() {
			return isExplicit();
		},
		get ready() {
			return resource?.state === 'ready' || resource?.state === 'partial';
		},
		get availableDates(): readonly string[] {
			const availability =
				resource?.index == null ? null : availabilityFromCollectionIndex(resource.index);
			const retained = availability == null ? [] : datesForAvailability(availability);
			return retained.length > 0 ? retained : (options.currentDates?.() ?? []);
		},
		get requestWindow() {
			return requestWindow(currentRequest(), options.isCompleteRequest);
		},
		get resolvedWindow() {
			return resource?.resolved?.selection ?? undefined;
		},
		get coverageText() {
			if (resource?.index == null) return null;
			const availability = availabilityFromCollectionIndex(resource.index);
			if (availability.kind !== 'continuous') return null;
			return options
				.copy()
				.coverage(
					options.formatDate(availability.firstDate),
					options.formatDate(availability.lastDate),
				);
		},
		get announcement() {
			return announcement;
		},
		get liveAnnouncement() {
			if (announcement != null) return announcement;
			return resource != null && isExplicit() ? stateAnnouncement(resource, options.copy()) : '';
		},
		clearRequest() {
			setRequest(emptyRequest());
		},
		selectRange(value: DateWindow | undefined) {
			announcement = null;
			handledCorrection = '';
			setRequest(
				value == null
					? emptyRequest()
					: { hasFrom: true, hasTo: true, rawFrom: value.from, rawTo: value.to },
			);
		},
		selectionText(value: DateWindow | undefined) {
			return value == null
				? null
				: options.copy().selection(options.formatDate(value.from), options.formatDate(value.to));
		},
		wireWindow(fallback?: DateWindow) {
			const canonical = resource?.resolved?.canonicalWindow ?? fallback;
			const request = currentRequest();
			const pending = isExplicit() && resource?.resolved == null;
			return {
				from: canonical?.from ?? (pending && request.hasFrom ? request.rawFrom : null),
				to: canonical?.to ?? (pending && request.hasTo ? request.rawTo : null),
			};
		},
	};
}
