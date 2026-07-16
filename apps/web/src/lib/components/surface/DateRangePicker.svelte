<!--
  DateRangePicker — the SHARED, availability-aware date-window control (S8B).

  ONE primitive every historic surface reuses to range over its REAL dated days
  (S8: the stop daily series; S13: the receipts index; lines: the day-grain
  periods). It is a PURE view + normalize: a start/end pair of native date PICKERS
  (<input type="date">) bounded (min/max) to the surface's `availableDates`, composing a NORMALIZED {@link DateWindow}
  (via $lib/filters normalizeWindow) on every change. GUARANTEE: min/max scope the
  native calendar to the surface's real span, but a native picker can't disable an
  INTERIOR gap-day or block a typed out-of-range value — either resolves HONESTLY
  through the surface's own absent-day / normalize path, never fabricated data; any
  pick order is valid (normalizeWindow swaps an inverted pair); a half pick (one
  bound cleared) yields NO window (`undefined`) — a fabricated / inverted span
  never leaves the primitive (honest-absence).

  S13-REUSABLE: the primitive knows only {DateWindow, availableDates, locale,
  labels} — zero stop/receipt/lines-specific fields. It seats into
  SurfaceControls' `window` Snippet slot with no primitive changes.

  S13 SINGLE MODE: `mode='single'` composes the SAME chrome into ONE native date
  PICKER bounded (min/max) to the `dateOptions` span, binding a single `date`
  instead of a window. Degradation from the old <select>: a native calendar can
  only BOUND via min/max (it can't DISABLE an interior gap-day), so a gap-day is
  pickable but resolves HONESTLY through the receipt's own absent-day path — no
  fabricated reading. `dateOptions` still gates hasDates (its length) and supplies
  the span's earliest/latest day; the producer's per-day disabled/reason fields
  aren't part of this primitive's contract (a native input can't render them). The
  range path is byte-identical, so the receipt reuses this primitive.

  HONEST ABSENCE: when `availableDates` is empty there is nothing to range over —
  the primitive renders an AbsentValue (via describeAbsence) with the caller's
  `emptyReason`, never a dead empty control.

  BILINGUAL: the primitive OWNS zero copy — every string is a prop (`labels`);
  the caller supplies them from its i18n bundle. a11y AA: a wrapping role="group"
  + aria-label, an aria-label per input, and a 44px min-height touch target on
  each input + the clear button. Native <input type="date"> gives the OS calendar
  + free keyboard/mobile.

  DOCTRINE: tokens-only styling (lifted from RRC's proven .reliability-date
  chrome — --card / --border / focus-visible --ring); NO tv() (not a ui/
  primitive); data-slot="date-range" on the root (house convention).
-->
<script module lang="ts">
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import type { Locale } from '$lib/i18n';
	import type { DateWindow } from '$lib/filters';

	/** Bilingual labels the caller supplies — the primitive owns NO copy. */
	export interface DateRangePickerLabels {
		/** Accessible group label over the whole start/end pair (or the single-date select). */
		readonly group: string;
		/** Start-bound select label. */
		readonly start: string;
		/** End-bound select label. */
		readonly end: string;
		/** Clear affordance label (resets the window to undefined). */
		readonly clear: string;
		/** The neutral placeholder option ("Earliest" / "Latest" — full-window sentinel). */
		readonly anyStart: string;
		readonly anyEnd: string;
		/**
		 * Single-date select label (S13, mode='single'). Optional — only the receipt's
		 * single-day picker supplies it; the range consumers never read it.
		 */
		readonly single?: string;
	}

	/**
	 * One day in the SINGLE-date calendar's availability span (S13, mode='single').
	 * The primitive reads only `date` — a native <input type="date"> bounds itself
	 * via min/max to the span's earliest/latest day; it can't disable an interior
	 * day or show a per-day reason, so those live only in the producer's own VM
	 * (presentAvailability) for its callers/tests, not in this primitive's contract.
	 */
	export interface SingleDateOption {
		readonly date: string;
	}

	/**
	 * DateRangePicker props (Props-export convention). Declared in the module script
	 * so it can be exported (this instance script has no `generics=`, but keeping the
	 * interface here matches the surface-primitive pattern + keeps one export site).
	 */
	export interface DateRangePickerProps {
		/**
		 * The active window (BINDABLE — in AND out). `undefined` = no span (the
		 * surface's full-window default). The primitive only ever emits a normalized
		 * window or `undefined`; it never stores a half/inverted span. Unused in
		 * mode='single' (the single-date pick binds {@link DateRangePickerProps.date}).
		 */
		value?: DateWindow | undefined;
		/**
		 * SINGLE-date mode (S13): a receipt is inherently ONE day, so the picker offers
		 * ONE availability-bound select instead of the {from,to} pair. Default 'range'
		 * → ZERO behaviour change for the stops/lines/network consumers. In 'single'
		 * mode {@link DateRangePickerProps.date} is the bindable value and
		 * {@link DateRangePickerProps.dateOptions} drives the calendar.
		 */
		mode?: 'range' | 'single';
		/**
		 * The chosen single day (BINDABLE — in AND out), ISO `YYYY-MM-DD`, in mode='single'.
		 * `undefined` = nothing chosen yet (the caller seeds its own default). Only a day
		 * the caller marks ENABLED can be picked; a disabled gap-day option is never emitted.
		 */
		date?: string | undefined;
		/**
		 * The SINGLE-date calendar (mode='single'): the full span earliest→latest with
		 * published days enabled and gap-days DISABLED + reasoned. Empty ⇒ honest absence.
		 * Ignored in range mode (which reads {@link DateRangePickerProps.availableDates}).
		 */
		dateOptions?: readonly SingleDateOption[];
		/**
		 * The surface's REAL dated days, ascending ISO `YYYY-MM-DD` (range mode). This IS
		 * the coverage source — options are these dates only, so an out-of-window pick is
		 * impossible. Empty ⇒ honest absence (nothing to range over).
		 */
		availableDates?: readonly string[];
		/** Locale for the honest-absence copy (describeAbsence). */
		locale: Locale;
		/** Bilingual labels (caller-supplied — the primitive owns no copy). */
		labels: DateRangePickerLabels;
		/** Absence reason when `availableDates` is empty. Default 'no-observations'. */
		emptyReason?: AbsenceReasonKey;
		/**
		 * Show the "clear" affordance (reset to the full-window default). Default true.
		 * A surface where the range is ONE segment of a larger radiogroup (lines: the
		 * grain owns the mode, the empty option is the sentinel) sets this false so the
		 * primitive matches its existing pick-a-start-and-end UX with no clear button.
		 */
		clearable?: boolean;
		/**
		 * Stack the fields VERTICALLY (one per row) instead of the default inline row.
		 * For a narrow rail (SurfaceRail) where two side-by-side date selects would crowd —
		 * the "no two filters on one row" layout. Default false (the inline row).
		 */
		stack?: boolean;
		class?: string;
	}
</script>

<script lang="ts">
	import { normalizeWindow } from '$lib/filters';
	import { AbsentValue } from '$lib/components/edge';

	let {
		value = $bindable(),
		mode = 'range',
		date = $bindable(),
		dateOptions = [],
		availableDates = [],
		locale,
		labels,
		emptyReason = 'no-observations',
		clearable = true,
		stack = false,
		class: className,
	}: DateRangePickerProps = $props();

	// The two raw bound selections. Kept as LOCAL UI state so a half pick (one bound
	// set, the other still empty) is representable WITHOUT emitting a window — the emit
	// path only fires a NORMALIZED window when BOTH bounds are set. This lets a rider
	// pick start, then end, across two interactions even though the composed window is
	// `undefined` in between (a fabricated/half span never leaves the primitive).
	let start = $state<string>(value?.from ?? '');
	let end = $state<string>(value?.to ?? '');

	// Re-seed the raw bounds ONLY on an EXTERNAL window change (a codec hydrate, a
	// deep-link ?from/?to, an owner clear) — NOT on our own emit. Guard on whether the
	// incoming `value` already matches the bounds we hold, so a half-pick (value ==
	// undefined while one bound is set) is NOT wiped by the effect re-running.
	$effect(() => {
		const from = value?.from ?? '';
		const to = value?.to ?? '';
		// External hydrate of a complete window whose bounds differ from ours.
		if (value != null && (from !== start || to !== end)) {
			start = from;
			end = to;
			return;
		}
		// External clear (value became undefined) AFTER a complete window was in place
		// (both bounds set) — reset. A half pick (exactly one bound set, value already
		// undefined) is left ALONE so an in-progress two-step pick survives.
		if (value == null && start !== '' && end !== '') {
			start = '';
			end = '';
		}
	});

	const hasDates = $derived(mode === 'single' ? dateOptions.length > 0 : availableDates.length > 0);

	/** Single-mode label (falls back to the group label so the a11y name is never empty). */
	const singleLabel = $derived(labels.single ?? labels.group);

	// Coverage BOUNDS for the native calendar pickers — the earliest/latest day the surface
	// actually carries. `availableDates` (range) + `dateOptions` (single) are ascending, so
	// [0]/[len-1] are first/last. A native <input type=date> can only BOUND via min/max (it
	// can't disable interior gap-days like the old <select> could) — an out-of-coverage or
	// interior-gap pick resolves HONESTLY through the surface's own clamp (resolveWindow /
	// the receipt's absent-day path), same philosophy as the range clamp. min/max keep the
	// calendar itself scoped to the real span.
	const minDate = $derived(availableDates.length ? availableDates[0] : undefined);
	const maxDate = $derived(
		availableDates.length ? availableDates[availableDates.length - 1] : undefined,
	);
	const singleMin = $derived(dateOptions.length ? dateOptions[0].date : undefined);
	const singleMax = $derived(
		dateOptions.length ? dateOptions[dateOptions.length - 1].date : undefined,
	);

	// RANGE CLAMP: once one bound is picked, the OTHER input's own min/max narrows to
	// it — the To field can't go earlier than the picked From day, and the From field
	// can't go later than the picked To day. This keeps the calendar itself honest
	// about the resulting window (normalizeWindow would swap an inverted pair anyway,
	// but the widget shouldn't invite picking one). Falls back to the surface's own
	// coverage bound when the other side isn't picked yet.
	const toMin = $derived(start || minDate);
	const fromMax = $derived(end || maxDate);

	/**
	 * Compose the two bounds into a normalized window (or clear it) and assign
	 * `value`. normalizeWindow swaps an inverted pair, so any pick order is valid; a
	 * missing bound yields `undefined` (NO window) — a half/inverted span is never
	 * stored, so a fabricated span never leaves the primitive (honest-absence).
	 */
	function emit(nextStart: string, nextEnd: string): void {
		start = nextStart;
		end = nextEnd;
		value = normalizeWindow(nextStart || null, nextEnd || null);
	}

	function clear(): void {
		emit('', '');
	}
</script>

{#if !hasDates}
	<!-- Nothing to range over — honest absence, never a dead empty control. -->
	<AbsentValue variant="block" reason={emptyReason} {locale} />
{:else if mode === 'single'}
	<!-- SINGLE-date calendar (S13): a native date PICKER bounded to the published
	     earliest→latest span (min/max). Degradation note: the old <select> could DISABLE an
	     interior gap-day the receipt index never published; a native calendar can only bound
	     via min/max, so an interior gap-day is pickable and resolves HONESTLY through the
	     receipt's own absent-day path (no fabricated reading). `dateOptions` (with its
	     disabled/reason fields) is still the coverage source that gates hasDates. -->
	<div
		class={['date-range', stack && 'date-range--stack', className]}
		data-slot="date-range"
		role="group"
		aria-label={labels.group}
	>
		<label class="date-range__field">
			<span class="date-range__label">{singleLabel}</span>
			<input
				type="date"
				name="history-date"
				class="date-range__input"
				value={date ?? ''}
				min={singleMin}
				max={singleMax}
				onchange={(e) => (date = e.currentTarget.value || undefined)}
				aria-label={singleLabel}
				data-slot="single-date"
			/>
		</label>
	</div>
{:else}
	<div
		class={['date-range', stack && 'date-range--stack', className]}
		data-slot="date-range"
		role="group"
		aria-label={labels.group}
	>
		<label class="date-range__field">
			<span class="date-range__label">{labels.start}</span>
			<input
				type="date"
				name="history-from"
				class="date-range__input"
				value={start}
				min={minDate}
				max={fromMax}
				onchange={(e) => emit(e.currentTarget.value, end)}
				aria-label={`${labels.group} · ${labels.start}`}
			/>
		</label>
		<label class="date-range__field">
			<span class="date-range__label">{labels.end}</span>
			<input
				type="date"
				name="history-to"
				class="date-range__input"
				value={end}
				min={toMin}
				max={maxDate}
				onchange={(e) => emit(start, e.currentTarget.value)}
				aria-label={`${labels.group} · ${labels.end}`}
			/>
		</label>
		<!-- Clear the window (back to the surface's full-window default). Shown only
		     when a span is actually set, so the affordance never invites a no-op. Opt
		     out (clearable=false) where the range is one segment of a larger radiogroup. -->
		{#if clearable && value != null}
			<button type="button" class="date-range__clear" onclick={clear}>{labels.clear}</button>
		{/if}
	</div>
{/if}

<style>
	.date-range {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1rem;
		min-width: 0;
	}
	/* Stacked variant (SurfaceRail): each field on its own row — no two filters share a row.
	   The field stays label + select on its line; the select fills the rail width. */
	.date-range--stack {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.625rem;
	}
	.date-range--stack .date-range__field {
		justify-content: space-between;
	}
	.date-range--stack .date-range__input {
		flex: 1 1 auto;
		min-width: 0;
	}
	.date-range__field {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.date-range__label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	/* Chrome lifted from RRC's proven .reliability-date__select — tokens only, AA in
	   both themes; native appearance keeps the free keyboard/mobile picker. 44px min
	   height is the WCAG 2.2 AA touch-target floor. */
	.date-range__input {
		appearance: auto;
		min-height: 44px;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: 0.375rem 0.5rem;
	}
	.date-range__input:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	/* Clear = an INTERACTION affordance (resets the span). Quiet ghost button; the
	   --primary accent stays out of the data canvas (chrome). */
	.date-range__clear {
		appearance: none;
		min-height: 44px;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		color: var(--muted-foreground);
		background-color: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 0.375rem 0.75rem;
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	.date-range__clear:hover {
		color: var(--foreground);
		border-color: var(--primary);
	}
	.date-range__clear:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.date-range__clear {
			transition: none;
		}
	}
</style>
