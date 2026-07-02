<!--
  DateRangePicker — the SHARED, availability-aware date-window control (S8B).

  ONE primitive every historic surface reuses to range over its REAL dated days
  (S8: the stop daily series; S13: the receipts index; lines: the day-grain
  periods). It is a PURE view + normalize: a start/end pair of native <select>s
  over the surface's `availableDates`, composing a NORMALIZED {@link DateWindow}
  (via $lib/filters normalizeWindow) on every change. Because the options are the
  surface's real dates ONLY, an out-of-coverage pick is impossible by
  construction; any pick order is valid (normalizeWindow swaps an inverted pair);
  a half pick (one bound cleared) yields NO window (`undefined`) — a fabricated /
  inverted span never leaves the primitive (honest-absence).

  S13-REUSABLE: the primitive knows only {DateWindow, availableDates, locale,
  labels} — zero stop/receipt/lines-specific fields. It seats into
  SurfaceControls' `window` Snippet slot with no primitive changes.

  HONEST ABSENCE: when `availableDates` is empty there is nothing to range over —
  the primitive renders an AbsentValue (via describeAbsence) with the caller's
  `emptyReason`, never a dead empty control.

  BILINGUAL: the primitive OWNS zero copy — every string is a prop (`labels`);
  the caller supplies them from its i18n bundle. a11y AA: a wrapping role="group"
  + aria-label, an aria-label per select, and a 44px min-height touch target on
  each select + the clear button. Native <select> gives free keyboard/mobile.

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
		/** Accessible group label over the whole start/end pair. */
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
		 * window or `undefined`; it never stores a half/inverted span.
		 */
		value: DateWindow | undefined;
		/**
		 * The surface's REAL dated days, ascending ISO `YYYY-MM-DD`. This IS the
		 * coverage source — options are these dates only, so an out-of-window pick is
		 * impossible. Empty ⇒ honest absence (nothing to range over).
		 */
		availableDates: readonly string[];
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
		class?: string;
	}
</script>

<script lang="ts">
	import { normalizeWindow } from '$lib/filters';
	import { AbsentValue } from '$lib/components/edge';

	let {
		value = $bindable(),
		availableDates,
		locale,
		labels,
		emptyReason = 'no-observations',
		clearable = true,
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

	const hasDates = $derived(availableDates.length > 0);

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
{:else}
	<div
		class={['date-range', className]}
		data-slot="date-range"
		role="group"
		aria-label={labels.group}
	>
		<label class="date-range__field">
			<span class="date-range__label">{labels.start}</span>
			<select
				class="date-range__select"
				value={start}
				onchange={(e) => emit(e.currentTarget.value, end)}
				aria-label={`${labels.group} · ${labels.start}`}
			>
				<option value="">{labels.anyStart}</option>
				{#each availableDates as d (d)}
					<option value={d}>{d}</option>
				{/each}
			</select>
		</label>
		<label class="date-range__field">
			<span class="date-range__label">{labels.end}</span>
			<select
				class="date-range__select"
				value={end}
				onchange={(e) => emit(start, e.currentTarget.value)}
				aria-label={`${labels.group} · ${labels.end}`}
			>
				<option value="">{labels.anyEnd}</option>
				{#each availableDates as d (d)}
					<option value={d}>{d}</option>
				{/each}
			</select>
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
	.date-range__select {
		appearance: auto;
		min-height: 44px;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 0.5rem);
		padding: 0.35rem 0.6rem;
	}
	.date-range__select:focus-visible {
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
		border-radius: var(--radius-pill, 999px);
		padding: 0.35rem 0.75rem;
		cursor: pointer;
		transition:
			color 0.15s ease,
			border-color 0.15s ease;
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
