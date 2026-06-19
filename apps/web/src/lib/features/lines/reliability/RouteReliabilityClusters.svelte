<!--
  RouteReliabilityClusters — the composed slice-9.6 historic Reliability surface
  (approach B: one band per cluster). This is the single component a route mounts;
  it owns the control spine and stitches the snapshot strip + the five numbered
  cluster bands into one edge-to-edge column.

  Shape:
    - a control spine (grain selector: Today / This week / This month + a
      specific-date affordance) drives WHICH grain the snapshot strip answers
      for. The headline answer is visible with ZERO interaction (the default
      grain, 'day'); the control only refines it.
    - `toReliabilityClusters(data, { grain })` is called ONCE ($derived) and each
      slice is handed to its band — the bands are pure presenters of their VM.
    - the full-bleed SnapshotStrip first, then bands 01→05 in order, each its own
      band with the mono numbered overline (the bands own their SectionLabel).

  HONESTY DOCTRINE (inherited from the VMs + enforced here):
    - a cluster whose VM `isEmpty` STILL renders its band (with the band's own
      no-data note) — never silently dropped. We render all six unconditionally.
    - the grain control never fabricates data: selecting a grain the contract has
      no period for resolves (via the mapper) to the first period, and an absent
      metric stays null → the band shows its honest empty, never a fake 0.

  Bilingual: FR is the canonical product voice. `locale` is threaded as a prop
  and the co-located `reliabilityCopy` bundle is passed to every band, so no band
  performs its own i18n lookup. Reduced-motion is honoured by the primitives.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Locale } from '$lib/i18n';
	import type { RouteReliability } from '$lib/v1';
	import { toReliabilityClusters } from './clusters';
	import { reliabilityCopy } from './reliability.copy';
	import SnapshotStrip from './SnapshotStrip.svelte';
	import Cluster01Punctuality from './Cluster01Punctuality.svelte';
	import Cluster02WaitRegularity from './Cluster02WaitRegularity.svelte';
	import Cluster03ServiceDelivered from './Cluster03ServiceDelivered.svelte';
	import Cluster04Crowding from './Cluster04Crowding.svelte';
	import Cluster05Habits from './Cluster05Habits.svelte';

	interface RouteReliabilityClustersProps {
		/** The raw historic reliability archive for this route. */
		data: RouteReliability;
		/** Active locale (FR canonical) — threaded to every band, not looked up here. */
		locale: Locale;
		/** Optional extra class for the surface column. */
		class?: string;
	}

	let { data, locale, class: className }: RouteReliabilityClustersProps = $props();

	const copy = $derived(reliabilityCopy[locale]);

	/* ── control spine ────────────────────────────────────────────────────────
	   The grain the snapshot strip answers for. The headline shows with ZERO
	   interaction at the default 'day' grain; the control only refines.

	   The three discrete grains map to free-string contract grains the mapper
	   selects against. "Specific date" is an affordance that swaps the segmented
	   control for a <select> over the dated periods the contract actually carries
	   (a date the archive has no period for would fabricate nothing — the mapper
	   falls back and the bands stay honest), so we only offer real dates.

	   TODO(orchestrator): mirror `grain` to a URL search param (?grain=) so the
	   selection is shareable/deep-linkable. Left out here to keep this component
	   route-agnostic — the orchestrator owns URL state when it wires the route. */
	type GrainMode = 'day' | 'week' | 'month' | 'date';
	let mode = $state<GrainMode>('day');
	let specificDate = $state<string>('');

	// Dated DAY-grain periods the contract carries (for the specific-date picker).
	// A day-grain period with a non-empty `date` qualifies — the picker offers a
	// concrete day, and the mapper resolves the strip/headline to THAT exact day.
	const datedPeriods = $derived(
		(data.periods ?? []).filter(
			(p): p is typeof p & { date: string } => p.grain === 'day' && !!p.date,
		),
	);
	const hasDatedPeriods = $derived(datedPeriods.length > 0);

	// Which calendar grains the contract actually carries — so we never offer a
	// grain segment that resolves to nothing (an empty grain is disabled, not a
	// silent no-op). The mapper still falls back honestly if reached.
	const availableGrains = $derived.by<Set<string>>(() => {
		const set = new Set<string>();
		for (const p of data.periods ?? []) {
			if (p.grain === 'day' || p.grain === 'week' || p.grain === 'month') set.add(p.grain);
		}
		return set;
	});

	// What the mapper resolves for. In date mode we thread the picked day to the
	// mapper via `selectedDate` (grain stays 'day') so the picker selects THAT
	// day — not merely the most-recent. Outside date mode the segment IS the grain.
	const mapperOpts = $derived<{ grain: string; selectedDate?: string }>(
		mode === 'date' ? { grain: 'day', selectedDate: specificDate || undefined } : { grain: mode },
	);
	const selectedGrain = $derived(mapperOpts.grain);

	// One mapping pass — every band reads its slice of this.
	const clusters = $derived(toReliabilityClusters(data, mapperOpts));

	// Segments carry an `available` flag; an unavailable grain renders disabled
	// (never selectable) so the control can't resolve to an empty grain.
	const segments = $derived<{ key: 'day' | 'week' | 'month'; label: string; available: boolean }[]>(
		[
			{ key: 'day', label: copy.controls.today, available: availableGrains.has('day') },
			{ key: 'week', label: copy.controls.thisWeek, available: availableGrains.has('week') },
			{ key: 'month', label: copy.controls.thisMonth, available: availableGrains.has('month') },
		],
	);

	// Active-window caption under the control spine — names the resolved window so
	// "Today / This week / This month / {date}" is never ambiguous about coverage.
	const activeWindowCaption = $derived.by<string>(() => {
		const aw = copy.controls.activeWindow;
		if (mode === 'date') return aw.date(specificDate);
		if (mode === 'week') return aw.week;
		if (mode === 'month') return aw.month;
		return aw.day;
	});

	// A11y label for the date <select> reuses the "Specific date" control label.
	const dateSelectLabel = $derived(copy.controls.specificDate);
</script>

<div class={cn('reliability-clusters', className)} data-slot="reliability-clusters">
	<!-- Control spine: refines the snapshot grain; the headline shows by default. -->
	<div class="reliability-controls" role="group" aria-label={copy.controls.specificDate}>
		<div class="reliability-segmented" role="radiogroup" aria-label={copy.controls.today}>
			{#each segments as seg (seg.key)}
				<button
					type="button"
					role="radio"
					class="reliability-seg"
					class:reliability-seg--active={mode === seg.key}
					aria-checked={mode === seg.key}
					disabled={!seg.available}
					onclick={() => seg.available && (mode = seg.key)}
				>
					{seg.label}
				</button>
			{/each}
			{#if hasDatedPeriods}
				<button
					type="button"
					role="radio"
					class="reliability-seg"
					class:reliability-seg--active={mode === 'date'}
					aria-checked={mode === 'date'}
					onclick={() => (mode = 'date')}
				>
					{copy.controls.specificDate}
				</button>
			{/if}
		</div>

		{#if mode === 'date' && hasDatedPeriods}
			<label class="reliability-date">
				<span class="reliability-date__label">{dateSelectLabel}</span>
				<select class="reliability-date__select" bind:value={specificDate}>
					<option value="">—</option>
					{#each datedPeriods as p (p.date)}
						<option value={p.date}>{p.date}</option>
					{/each}
				</select>
			</label>
		{/if}
	</div>

	<!-- Active-window caption: names the window the selection resolves to so the
	     reader is never unsure what "Today / This week / {date}" actually covers. -->
	<p class="reliability-window" data-slot="active-window" aria-live="polite">
		{activeWindowCaption}
	</p>

	<!-- 00 — the full-bleed snapshot strip (single-glance, zero-interaction). -->
	<div class="reliability-band reliability-band--strip surface-bleed" data-band="snapshot">
		<SnapshotStrip vm={clusters.strip} {locale} {copy} />
	</div>

	<!-- 01 Punctuality. -->
	<div class="reliability-band surface-bleed" data-band="punctuality">
		<Cluster01Punctuality vm={clusters.punctuality} {locale} {copy} grain={selectedGrain} />
	</div>

	<!-- 02 Wait regularity (service spans ride alongside the headway sub-block). -->
	<div class="reliability-band surface-bleed" data-band="wait-regularity">
		<Cluster02WaitRegularity
			wait={clusters.waitRegularity}
			serviceSpans={clusters.serviceDelivered.serviceSpans}
			{locale}
			{copy}
		/>
	</div>

	<!-- 03 Service delivered (ramp-in: cancellations + skipped stops). -->
	<div class="reliability-band surface-bleed" data-band="service-delivered">
		<Cluster03ServiceDelivered vm={clusters.serviceDelivered} {locale} {copy} />
	</div>

	<!-- 04 Crowding. -->
	<div class="reliability-band surface-bleed" data-band="crowding">
		<Cluster04Crowding vm={clusters.crowding} {locale} {copy} />
	</div>

	<!-- 05 Time-of-day habits (weekday seasonality rides alongside the heatmap). -->
	<div class="reliability-band surface-bleed" data-band="habits">
		<Cluster05Habits
			habits={clusters.habits}
			dayOfWeek={clusters.punctuality.dayOfWeek}
			{locale}
			{copy}
		/>
	</div>
</div>

<style>
	.reliability-clusters {
		display: flex;
		flex-direction: column;
		gap: clamp(2rem, 5vw, 3.25rem);
		width: 100%;
	}

	/* Control spine. */
	.reliability-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
	}
	.reliability-segmented {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg, 0.75rem);
		background-color: var(--card);
	}
	.reliability-seg {
		appearance: none;
		border: 0;
		background: transparent;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		padding: 0.4rem 0.8rem;
		border-radius: var(--radius-md, 0.5rem);
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.reliability-seg:hover:not(:disabled) {
		color: var(--foreground);
	}
	/* A grain the contract has no period for is disabled, never a silent no-op. */
	.reliability-seg:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	/* The active chip is an INTERACTION accent — --primary belongs here (never on
	   a data mark). The bands own the data-colour doctrine. */
	.reliability-seg--active {
		background-color: var(--primary);
		color: var(--primary-foreground);
	}
	.reliability-seg:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.reliability-seg {
			transition: none;
		}
	}

	.reliability-date {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.reliability-date__label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.reliability-date__select {
		appearance: auto;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 0.5rem);
		padding: 0.35rem 0.6rem;
	}
	.reliability-date__select:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	/* Active-window caption — quiet mono, AA against the page surface; chrome, so
	   it stays in the reading column (not bled) alongside the control spine. */
	.reliability-window {
		margin: -0.5rem 0 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}

	/* Each band is its own edge-to-edge block; the strip carries a quiet rule so
	   the single-glance headline reads as its own register above the clusters.
	   Bands opt into full-bleed at the wrapper (.surface-bleed, see Surface.svelte)
	   so the data marks reach the content-column edges; dense prose inside re-caps
	   itself via .surface-measure. The control spine (.reliability-controls) stays
	   within the reading column — it is chrome, not a band, so it is NOT bled. */
	.reliability-band {
		width: 100%;
	}
	.reliability-band--strip {
		padding-bottom: clamp(1.5rem, 4vw, 2.25rem);
		border-bottom: 1px solid var(--border);
	}
</style>
