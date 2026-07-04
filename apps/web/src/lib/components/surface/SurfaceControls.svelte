<!--
  SurfaceControls — the SEATED, availability-aware grain/window control rail.

  ONE primitive that composes the existing ControlsRail (quiet chrome) + GrainPicker
  (radiogroup) into the shared control spine every historic surface reuses (S8–S15).
  It owns the data-depth availability CLAMP (via $lib/filters usableFromOffered — the
  Chart Doctrine MIN_POINTS floor), DISABLES (never hides) a grain that lacks enough
  buckets with an honest-absence reason, and is a PURE view+dispatch: no local state,
  no URL writes. The active grain is owned UPSTREAM (P1's filter codec) — this rail
  never clamps or writes `value`; a value pointing at a now-disabled grain still
  renders as the active chip, and the owning codec resolves it on hydrate.

  DOCTRINE: --primary lives ONLY on the active grain chip (delegated to GrainPicker);
  the rail chrome stays quiet (ControlsRail). Bilingual labels + the disabled reason
  come from the caller. a11y: the radiogroup + roving tabindex + arrow-key nav +
  disabled-skip are GrainPicker's (WCAG 2.2 AA). This rail adds the disabled reason
  (aria-describedby + title) so a screen reader announces WHY a grain is off, AND a
  positive per-grain hint on ENABLED grains (default "Daily/Weekly/Monthly granularity",
  overridable via `grainHints`) so a hover/announce clarifies what the grain shows.

  SLOTS: `window` (a surface's window/range affordance — e.g. lines' from/to selects,
  network's 7/30/90) and `nav` (a section-TOC / jump-to) render inside the rail body;
  the primitive is agnostic to their content, and their controls dispatch through the
  SAME upstream codec the consumer wires (no state leaks in).
-->
<script module lang="ts">
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import type { Locale } from '$lib/i18n';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/**
	 * Per-key data-depth the surface reports; the primitive computes availability.
	 * A Grain-typed key is clamped by its `buckets` against the MIN_POINTS floor; a
	 * NON-Grain key (e.g. a lines-only "range" mode) has no bucket count, so the
	 * surface passes an explicit `available` boolean instead.
	 *
	 * Declared in the module script so it can be exported (the instance script is
	 * `generics=`, which disallows exports).
	 */
	export interface GrainAvailability {
		/** Trustworthy (non-null) bucket count for a Grain key (the data-depth clamp). */
		readonly buckets?: number;
		/** Explicit enable flag — overrides the bucket clamp (for non-Grain keys). */
		readonly available?: boolean;
		/** Override the auto absence reason when disabled (default 'no-observations'). */
		readonly absentReason?: AbsenceReasonKey;
	}

	/**
	 * SurfaceControls props (Props-export convention). Declared in the module script
	 * so it can be exported (the instance script is `generics=`, which disallows
	 * exports); it is generic over the segment key `K`, defaulting to `string` here
	 * (the instance narrows the default to `Grain`). Extends the rail's forwarded
	 * HTML attributes (minus `children`) so a11y attrs like `aria-label` pass through
	 * to ControlsRail — matching ControlsRail's own Omit<HTMLAttributes,'children'>.
	 */
	export interface SurfaceControlsProps<K extends string = string> extends Omit<
		HTMLAttributes<HTMLElement>,
		'children'
	> {
		/** The keys this surface OFFERS, finest→coarsest. Rendered as radios; unavailable ones disabled. */
		offered: readonly K[];
		/** key → data-depth signal. A missing entry = 0 buckets = disabled. */
		availability: Partial<Record<K, GrainAvailability>>;
		/**
		 * The active key (BINDABLE — the ONLY binding; the owner is P1's codec).
		 * SurfaceControls never clamps or writes it.
		 */
		value: K;
		/** Min trustworthy buckets to ENABLE a Grain key. Default MIN_POINTS_PER_GRAIN (7). */
		minPoints?: number;
		/** Bilingual key labels: key → label (caller supplies from i18n). */
		labels: Partial<Record<K, string>>;
		/**
		 * Optional positive per-key explainer shown as an ENABLED segment's tooltip +
		 * aria-description (the grain/sub-grain confusion fix — a hover on "Week" says
		 * what it shows). Overrides the built-in default (day/week/month → "… granularity")
		 * that this rail applies automatically to the standard Grain keys.
		 */
		grainHints?: Partial<Record<K, string>>;
		/** Bilingual radiogroup label (e.g. "Granularity" / "Granularité"). */
		grainLabel: string;
		/** Bilingual rail overline (e.g. "View" / "Vue"); omit = unlabelled plain group. */
		railLabel?: string;
		/** Locale for the disabled-reason absence copy (describeAbsence). */
		locale: Locale;
		/** Desktop sticky (forwarded to ControlsRail). Default false. */
		sticky?: boolean;
		/** Active-window caption text (caller-resolved; rendered under the picker, aria-live=polite). */
		windowCaption?: string;
		/**
		 * Window/date-range affordance slot (e.g. lines' from/to selects, network's
		 * 7/30/90). Rendered in the rail body after the picker; the primitive is
		 * agnostic to its content and owns no window state.
		 */
		window?: Snippet;
		/** Leading slot for a section-TOC / jump-to nav (lines' row-1 nav) — kept generic. */
		nav?: Snippet;
		class?: string;
	}
</script>

<script lang="ts" generics="K extends string = Grain">
	import type { Grain } from '$lib/v1/schemas';
	import { describeAbsence } from '$lib/site/absence';
	import { usableFromOffered, MIN_POINTS_PER_GRAIN, isGrain } from '$lib/filters';
	import { ControlsRail } from '$lib/components/layout';
	import GrainPicker from './GrainPicker.svelte';
	import type { GrainSegment } from './GrainPicker.svelte';

	let {
		offered,
		availability,
		value = $bindable(),
		minPoints = MIN_POINTS_PER_GRAIN,
		labels,
		grainHints,
		grainLabel,
		railLabel,
		locale,
		sticky = false,
		windowCaption,
		window: windowSlot,
		nav,
		class: className,
		...restProps
	}: SurfaceControlsProps<K> = $props();

	/**
	 * The DRY built-in positive hint for the standard Grain keys — the roll-up
	 * granularity in plain words, accurate on every surface (it names what the grain
	 * DOES, not a surface-specific sub-grain rendering). A caller can override or extend
	 * per key via `grainHints`. Non-Grain keys (a lines "range" mode, hotspots "shift")
	 * get no default — pass `grainHints` for those.
	 */
	const DEFAULT_GRAIN_HINTS: Record<Locale, Partial<Record<Grain, string>>> = {
		en: { day: 'Daily granularity', week: 'Weekly granularity', month: 'Monthly granularity' },
		fr: {
			day: 'Granularité quotidienne',
			week: 'Granularité hebdomadaire',
			month: 'Granularité mensuelle',
		},
	};

	/** Instance-unique id prefix so a disabled reason's description id never collides
	 *  across two SurfaceControls on one page (e.g. /stop's two rails). */
	const uid = $props.id();

	/**
	 * The usable (enabled) subset. Grain keys go through the SHARED data-depth clamp
	 * ($lib/filters usableFromOffered — the MIN_POINTS floor); a key with an explicit
	 * `available` flag (a non-Grain mode) honours that flag directly. No bespoke logic.
	 */
	const usable = $derived.by<Set<K>>(() => {
		// Grain-typed keys with a bucket count → the shared data-depth clamp.
		const grainCounts: Partial<Record<Grain, number>> = {};
		const grainKeys: Grain[] = [];
		for (const k of offered) {
			if (isGrain(k) && availability[k]?.available === undefined) {
				grainKeys.push(k);
				grainCounts[k] = availability[k]?.buckets ?? 0;
			}
		}
		const clamped = new Set<string>(usableFromOffered(grainKeys, grainCounts, minPoints));
		// Build the usable set IMMUTABLY (filter → Set-from-array): a mutated `new Set()`
		// held in a $derived trips svelte/prefer-svelte-reactivity. Constructing from an
		// already-filtered array sidesteps the reactive-mutation lint without a SvelteSet.
		return new Set<K>(
			offered.filter((k) => {
				const explicit = availability[k]?.available;
				return explicit !== undefined ? explicit : clamped.has(k);
			}),
		);
	});

	/** The disabled-reason description per offered key, resolved once from absence copy. */
	const reasons = $derived.by<Partial<Record<K, string>>>(() => {
		const out: Partial<Record<K, string>> = {};
		for (const k of offered) {
			if (usable.has(k)) continue;
			const reason: AbsenceReasonKey = availability[k]?.absentReason ?? 'no-observations';
			out[k] = describeAbsence(reason, locale).why;
		}
		return out;
	});

	/** The positive per-key hint for each ENABLED key — the caller's `grainHints` override,
	 *  else the built-in default for the standard Grain keys (day/week/month). Non-Grain
	 *  keys with no override get no hint (undefined). */
	const hints = $derived.by<Partial<Record<K, string>>>(() => {
		const out: Partial<Record<K, string>> = {};
		for (const k of offered) {
			if (!usable.has(k)) continue;
			const override = grainHints?.[k];
			const fallback = isGrain(k) ? DEFAULT_GRAIN_HINTS[locale][k] : undefined;
			const hint = override ?? fallback;
			if (hint) out[k] = hint;
		}
		return out;
	});

	/** The GrainPicker segments — every offered key rendered. Unusable ones are disabled,
	 *  each carrying its honest-absence reason; enabled ones carry their positive hint —
	 *  both via aria-describedby + the pointer title. */
	const segments = $derived<GrainSegment<K>[]>(
		offered.map((k) => {
			const enabled = usable.has(k);
			if (!enabled) {
				return {
					key: k,
					label: labels[k] ?? k,
					available: false,
					describedById: `${uid}-reason-${k}`,
					title: reasons[k],
				};
			}
			const hint = hints[k];
			return {
				key: k,
				label: labels[k] ?? k,
				available: true,
				...(hint ? { hint, describedById: `${uid}-hint-${k}` } : {}),
			};
		}),
	);
</script>

<!-- restProps forwards caller a11y attrs (e.g. aria-label) onto the rail (matching
     ControlsRail's Omit<HTMLAttributes,'children'>). data-slot is the house convention;
     data-surface-controls is retained because RRC's :global CSS keys off it. -->
<ControlsRail
	{sticky}
	label={railLabel}
	class={className}
	data-slot="surface-controls"
	data-surface-controls
	{...restProps}
>
	{#if nav}
		<div class="surface-controls__nav" data-slot="controls-nav">
			{@render nav()}
		</div>
	{/if}

	<div class="surface-controls__body" data-slot="controls-body">
		<GrainPicker {segments} bind:value label={grainLabel} />

		<!-- Disabled-reason descriptions: one visually-hidden span per disabled grain,
		     referenced by its radio via aria-describedby + surfaced as the radio's title
		     for pointer users. NEVER removes the segment (disable-never-hide). -->
		{#each offered as k (k)}
			{#if reasons[k]}
				<span id={`${uid}-reason-${k}`} class="surface-controls__reason" data-slot="controls-reason"
					>{reasons[k]}</span
				>
			{/if}
		{/each}

		<!-- Positive per-grain hints: one visually-hidden span per ENABLED grain that has
		     a hint, referenced by its radio via aria-describedby + surfaced as the radio's
		     title for pointer users (the grain/sub-grain clarity fix). -->
		{#each offered as k (k)}
			{#if hints[k]}
				<span id={`${uid}-hint-${k}`} class="surface-controls__reason" data-slot="controls-hint"
					>{hints[k]}</span
				>
			{/if}
		{/each}

		{#if windowSlot}
			<div class="surface-controls__window" data-slot="controls-window">
				{@render windowSlot()}
			</div>
		{/if}

		{#if windowCaption}
			<p class="surface-controls__caption" data-slot="active-window" aria-live="polite">
				{windowCaption}
			</p>
		{/if}
	</div>
</ControlsRail>

<style>
	.surface-controls__nav {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem 1.25rem;
		width: 100%;
		min-width: 0;
	}
	.surface-controls__body {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem 0.75rem;
		min-width: 0;
	}
	.surface-controls__window {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1rem;
	}
	/* Visually-hidden disabled-reason description — carried for screen readers via
	   aria-describedby on the disabled radio; never shown, never a layout box. */
	.surface-controls__reason {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	/* Active-window caption — quiet mono note; drops onto its own row beneath the chips. */
	.surface-controls__caption {
		margin: 0;
		flex-basis: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.3;
		color: var(--muted-foreground);
	}
</style>
