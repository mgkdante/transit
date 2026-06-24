<!--
  MaybeValue — the inline value-or-absence primitive.

  Renders its value (or `children`) when the datum is PRESENT, otherwise the
  styled honest-absence chip (AbsentValue: calm "unknown · why"). It is the
  free-standing-cell sibling of the two other absence-aware primitives:
    · MetricDisplay — big-number KPI tiles (its empty branch renders AbsentValue),
    · RankedRow     — ranked-list rows (its display slot renders AbsentValue),
    · MaybeValue    — any other inline cell (a <dd>, a meta line, a pill slot).
  Every inline "show the value, or say no-data AND why" site routes through ONE of
  these instead of hand-rolling a `{#if}{:else}<AbsentValue/>` branch per surface.

  PRESENCE — explicit `present` prop wins; otherwise inferred from `value`
  (non-null, non-empty-string). A real measured 0 ("0", "0%", "0 min") is PRESENT
  and renders as a real value — ONLY null / undefined / "" becomes the chip, never
  a fabricated zero. No business logic lives here: the surface picks the honest
  `reason`; this component only chooses value-vs-chip and forwards the reason.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import AbsentValue from './AbsentValue.svelte';
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import type { Locale } from '$lib/i18n';

	export interface MaybeValueProps {
		/**
		 * The formatted value rendered when present (and no `children` is supplied).
		 * `null` / `undefined` / "" reads as absent → the styled chip.
		 */
		value?: string | null;
		/**
		 * Explicit presence override. Use when presence is decided by a RAW datum
		 * rather than the formatted string (e.g. `present={stop != null}` while the
		 * shown content is a richer `children` snippet). Defaults to
		 * `value != null && value !== ''`.
		 */
		present?: boolean;
		/**
		 * Rich present-content (a chip, a localized phrase, a formatted compound).
		 * Rendered instead of `value` when present. Use for cells that show more than
		 * a bare formatted string.
		 */
		children?: Snippet;
		/** The typed absence reason (the WHY), from the logic layer. */
		reason: AbsenceReasonKey;
		/** UI language for the absence copy. */
		locale: Locale;
		/** Copy params interpolated into the absence WHY (e.g. { first: '06:00' }). */
		params?: Readonly<Record<string, string | number>>;
		/** AbsentValue variant: inline chip (default) or block panel. */
		variant?: 'inline' | 'block';
	}

	let {
		value,
		present,
		children,
		reason,
		locale,
		params,
		variant = 'inline',
	}: MaybeValueProps = $props();

	// Present when explicitly told, else when the formatted value is a real string.
	// A measured "0" is present; only null/undefined/"" falls through to the chip.
	const show = $derived(present ?? (value != null && value !== ''));
</script>

{#if show}{#if children}{@render children()}{:else}{value}{/if}{:else}<AbsentValue
		{reason}
		{locale}
		{params}
		{variant}
	/>{/if}
