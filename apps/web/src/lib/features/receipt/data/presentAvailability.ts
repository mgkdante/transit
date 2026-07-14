// presentAvailability — the receipt DATE-PICKER availability model (S13 · WEB3).
//
// Classifies the FULL span earliest→latest, with published days enabled and any
// gap-day in between DISABLED, each carrying an honest reason. This pure presenter
// turns the ReceiptsIndex ({dates} + the S13 {available} metadata) into the ordered
// ReceiptDateOption[] this module's tests assert on, plus the flat list of enabled
// dates the default/seed logic reads. NOTE: the DateRangePicker primitive
// (mode='single') is a native <input type="date"> — it reads only each option's
// `date` to bound its min/max span; it can't render a per-day disabled state or
// reason, so `disabled`/`disabledLabel`/`label` are this module's own classification
// output, not part of the primitive's contract.
//
// HONEST REASONS (WEB3 · DB3): the `available[]` metadata distinguishes
//   · a PUBLISHED day with telemetry            → enabled;
//   · a PUBLISHED day whose schedule is known but has NO telemetry (has_data=false,
//     has_schedule=true) → enabled but flagged 'schedule only' (the receipt still
//     stands, it just carries no reliability reading);
//   · a GAP day the index never published        → DISABLED, 'no receipt';
//   · an EMPTY published shell (no data, no schedule) → DISABLED, 'empty'.
// A day present in `dates` but absent from `available` (a pre-S13 index) is treated
// as a plain enabled published day (back-compat: the availability layer is additive).
//
// TIMEZONE SAFETY: the span is enumerated by ISO `YYYY-MM-DD` STRING math (UTC-noon
// anchored, +1 day at a time), never local `Date()` parsing — so a DST boundary can
// never drop or duplicate a service day (the America/Montréal service-day is a pure
// calendar label here, not a wall-clock instant).

import type { ReceiptsIndex, ReceiptAvailability } from '$lib/v1/schemas';
import type { SingleDateOption } from '$lib/components/surface';

/** The kind of a calendar day in the picker — drives the option's enabled state + reason. */
export type ReceiptDayKind =
	| 'published' // a real receipt with telemetry — enabled
	| 'schedule-only' // published, schedule known, no telemetry — enabled (flagged)
	| 'gap' // never published in the span — disabled
	| 'empty'; // published shell, no data + no schedule — disabled

/** Bilingual reason labels the caller supplies for the DISABLED / flagged days (owns no copy). */
export interface ReceiptAvailabilityLabels {
	/** Localized short date for an ISO day (e.g. "Jun 16"). */
	readonly formatDate: (iso: string) => string;
	/** Appended to a gap-day option (no receipt published for the day). */
	readonly gap: string;
	/** Appended to an empty published shell (no data, no schedule). */
	readonly empty: string;
	/** Flag suffix for a published day whose schedule is known but telemetry absent. */
	readonly scheduleOnly?: string;
}

/**
 * A calendar day in the receipt's availability span. Extends the primitive's
 * {@link SingleDateOption} (which reads only `date` — a native calendar can't
 * disable an interior day or show a per-day reason) with this presenter's own
 * classification fields; this module's own tests assert on `disabled` /
 * `disabledLabel` directly, and `label` documents the resolved caption even
 * though the current DateRangePicker primitive ignores both.
 */
export interface ReceiptDateOption extends SingleDateOption {
	readonly label: string;
	readonly disabled: boolean;
	/** Localized reason appended to a disabled day. */
	readonly disabledLabel?: string;
}

/** The availability view-model the orchestrator + picker consume. */
export interface AvailabilityVM {
	/** The full calendar as ordered picker options (published enabled, gaps disabled). */
	readonly options: ReceiptDateOption[];
	/** The ENABLED, published dates ascending (what the default/seed reads). */
	readonly enabledDates: string[];
	/** True when at least one day is published (else the picker stands down entirely). */
	readonly hasAny: boolean;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Next ISO calendar day (`YYYY-MM-DD` → the following day), UTC-anchored string math. */
function nextIsoDay(iso: string): string {
	// Anchor at UTC noon so a +1-day step never crosses a DST edge into the wrong day.
	const d = new Date(`${iso}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}

/** Classify one calendar day from the availability metadata (absent = plain published). */
function classify(
	iso: string,
	meta: ReceiptAvailability | undefined,
	published: boolean,
): ReceiptDayKind {
	if (!published) return 'gap';
	if (!meta) return 'published'; // pre-S13 index / no metadata → a plain published day
	if (meta.has_data) return 'published';
	// No telemetry: schedule-known is still a real (flagged) receipt; otherwise an empty shell.
	return meta.has_schedule ? 'schedule-only' : 'empty';
}

/**
 * Build the availability VM from the receipts index. `dates` is the published set
 * (ascending); `available[]` (S13) carries the per-day has_data/has_schedule flags.
 * The span runs earliest→latest published day; every calendar day in between that is
 * NOT published becomes a disabled 'gap' option (honest — the reader sees the hole).
 */
export function selectAvailability(
	index: ReceiptsIndex | null | undefined,
	labels: ReceiptAvailabilityLabels,
): AvailabilityVM {
	const dates = (index?.dates ?? []).filter((d) => ISO_RE.test(d));
	if (dates.length === 0) {
		return { options: [], enabledDates: [], hasAny: false };
	}

	// Published set + the per-date metadata index (keyed by ISO day).
	const published = new Set(dates);
	const metaByDate = new Map<string, ReceiptAvailability>();
	for (const a of index?.available ?? []) {
		if (ISO_RE.test(a.date)) metaByDate.set(a.date, a);
	}

	const sorted = [...dates].sort();
	const earliest = sorted[0];
	const latest = sorted[sorted.length - 1];

	const options: ReceiptDateOption[] = [];
	const enabledDates: string[] = [];
	// Enumerate the FULL retained span (bounded by the 1,000-day safety guard) so a
	// gap-day shows as a disabled option rather than silently vanishing.
	let cursor = earliest;
	// Hard guard against a malformed span (should never loop away, but never hang).
	for (let guard = 0; guard < 1000; guard++) {
		const isPublished = published.has(cursor);
		const kind = classify(cursor, metaByDate.get(cursor), isPublished);
		const enabled = kind === 'published' || kind === 'schedule-only';
		const label = labels.formatDate(cursor);
		options.push({
			date: cursor,
			label:
				kind === 'schedule-only' && labels.scheduleOnly
					? `${label} · ${labels.scheduleOnly}`
					: label,
			disabled: !enabled,
			disabledLabel: kind === 'gap' ? labels.gap : kind === 'empty' ? labels.empty : undefined,
		});
		if (enabled) enabledDates.push(cursor);
		if (cursor === latest) break;
		cursor = nextIsoDay(cursor);
	}

	return { options, enabledDates, hasAny: enabledDates.length > 0 };
}
