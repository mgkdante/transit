<!--
  RepeatOffendersSection — one grain's worst-N recurrence ladder, split into
  trip|vehicle TABS (S14 re-seat; mirrors HotspotSection exactly).

  A PURE presenter: the orchestrator ranks trip and vehicle on SEPARATE per-kind
  ladders (rank restarts per kind) and hands this file one built ladder + tray PER
  KIND. This section renders the two kinds as tabs on the tabs primitive (the yesid
  StationTabs look), each tab showing its own MagnitudeBarsSpec lollipop on the
  ABSOLUTE SEVERE_DOMAIN [0,100], the honest per-kind shown/total heading, the worst-N
  GrainPicker, the trailing-window caption, and the kind's un-ranked tray. The
  natural-frequency recurrence line rides EACH bar's note (built by the orchestrator's
  ladder note builder). Tab state is LOCAL; worstN binds UP to the orchestrator's
  codec-seeded value; the specs arrive built. This file owns NO math and NO
  cross-surface state.

  HONESTY: a kind with no ranked entry (shown === 0) degrades to the styled AbsentValue
  chip (says WHY), never a fake 0; a null severe_pct row draws MagnitudeBars' own
  no-data swatch. The tray is a quiet list — the entities exist but sit below the
  ranking floor, shown for transparency and explicitly NOT ranked. A tab whose kind
  serves neither a ranked entry nor a tray row is HIDDEN (never a dead, empty tab).
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import type { WorstN } from '$lib/filters';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { Chart } from '$lib/components/dataviz/chart';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { GrainPicker, type GrainSegment } from '$lib/components/surface';
	import { AbsentValue } from '$lib/components/edge';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { OffenderLadderResult } from '../selectors/offenderLadder';
	import { worstNSegments, SMALLEST_WORST_N } from '../data/ladderCap';
	import type { RepeatOffendersCopy } from '../repeatOffenders.copy';

	interface MetricInfoVM {
		readonly tip: string;
		readonly href: string;
		readonly label: string;
		readonly linkLabel: string;
	}
	interface TrayRow {
		readonly key: string;
		readonly title: string;
		readonly subtitle: string;
		readonly href: string | null;
		readonly ariaLabel: string;
	}
	interface RecurrenceLine {
		readonly key: string;
		readonly label: string;
		readonly text: string;
	}

	type KindKey = 'trip' | 'vehicle';

	interface RepeatOffendersSectionProps {
		/** Section heading (the ladder heading). */
		heading: string;
		/** The trip-kind ladder spec + total/shown (from selectOffenderLadder). */
		tripLadder: OffenderLadderResult;
		/** The vehicle-kind ladder spec + total/shown. */
		vehicleLadder: OffenderLadderResult;
		/** The trip-kind un-ranked tray rows (sub-MIN_N entities) — already mapped. */
		tripTray: readonly TrayRow[];
		/** The vehicle-kind un-ranked tray rows. */
		vehicleTray: readonly TrayRow[];
		/** The trip-kind VISIBLE natural-frequency recurrence lines (one per shown ranked row). */
		tripRecurrence: readonly RecurrenceLine[];
		/** The vehicle-kind visible recurrence lines. */
		vehicleRecurrence: readonly RecurrenceLine[];
		/** The trailing-window caption for the active grain. */
		windowCaption: string;
		/** The (i) metric explainer VM for the severe-rate column. */
		info: MetricInfoVM;
		/** The codec-owned worst-N cap (BINDABLE — owner is the orchestrator). */
		worstN: WorstN;
		locale: Locale;
		copy: RepeatOffendersCopy;
	}
	let {
		heading,
		tripLadder,
		vehicleLadder,
		tripTray,
		vehicleTray,
		tripRecurrence,
		vehicleRecurrence,
		windowCaption,
		info,
		worstN = $bindable(),
		locale,
		copy,
	}: RepeatOffendersSectionProps = $props();

	const t = $derived(copy);
	const segments = $derived<GrainSegment<WorstN>[]>(worstNSegments(t.worstN.all));

	// One tab per kind. A kind is OFFERED only when it serves at least one ranked entry
	// OR a tray row — a kind with nothing at all is never a dead tab.
	interface KindTab {
		readonly key: KindKey;
		readonly label: string;
		readonly ladder: OffenderLadderResult;
		readonly tray: readonly TrayRow[];
		readonly recurrence: readonly RecurrenceLine[];
	}
	const allTabs = $derived<KindTab[]>([
		{
			key: 'trip',
			label: t.type.trip,
			ladder: tripLadder,
			tray: tripTray,
			recurrence: tripRecurrence,
		},
		{
			key: 'vehicle',
			label: t.type.vehicle,
			ladder: vehicleLadder,
			tray: vehicleTray,
			recurrence: vehicleRecurrence,
		},
	]);
	const tabs = $derived(allTabs.filter((tab) => tab.ladder.shown > 0 || tab.tray.length > 0));

	// LOCAL tab state (no ?kind param — like other in-page tabs). Default to the first
	// OFFERED kind so the active tab is always populated; re-clamp if the offered set
	// changes (e.g. a grain switch drops the active kind).
	let active = $state<KindKey>('trip');
	$effect(() => {
		if (tabs.length > 0 && !tabs.some((tab) => tab.key === active)) active = tabs[0].key;
	});

	// The worst-N control is dead when the active kind's full ranked set is smaller than
	// the smallest rung — render it only when there's something to cap (the S7 total > 5 gate).
	function showWorstNFor(l: OffenderLadderResult): boolean {
		return l.total > SMALLEST_WORST_N;
	}
	// Honest shown/total heading suffix (only when the cap actually truncated).
	function headingTextFor(l: OffenderLadderResult): string {
		return l.total > l.shown ? `${heading} ${t.shownOfTotal(l.shown, l.total)}` : heading;
	}
</script>

<section class="offender-section" data-slot="offender-section">
	{#if tabs.length > 0}
		<Tabs bind:value={active}>
			<TabsList variant="line" class="w-full justify-start">
				{#each tabs as tab (tab.key)}
					<!-- Signage-active tab look (the yesid StationTabs pattern): bits-ui owns
					     behavior / ARIA; the child <button> owns the metro-signage active chip. -->
					<TabsTrigger value={tab.key}>
						{#snippet child({ props })}
							<button {...props} class="station-tab" class:active={tab.key === active}
								>{tab.label}</button
							>
						{/snippet}
					</TabsTrigger>
				{/each}
			</TabsList>

			{#each tabs as tab (tab.key)}
				<TabsContent value={tab.key} class="offender-tab-pane">
					{#if tab.ladder.shown > 0}
						<div class="offender-section-head">
							<SectionHeading level={2} overline={headingTextFor(tab.ladder)}>
								{#snippet explainer()}
									<MetricInfo
										class="offender-info"
										tip={info.tip}
										href={info.href}
										label={info.label}
										linkLabel={info.linkLabel}
										side="bottom"
									/>
								{/snippet}
							</SectionHeading>
							{#if showWorstNFor(tab.ladder)}
								<GrainPicker {segments} bind:value={worstN} label={t.worstN.label} />
							{/if}
						</div>
						<p class="caption" data-slot="offender-window">{windowCaption}</p>
						<div data-slot="offender-ladder">
							<Chart spec={tab.ladder.spec} />
						</div>
						<!-- The VISIBLE natural-frequency recurrence line per ranked row — the on-screen
						     evidence that the ranking is a RECURRENCE, not a one-off average. -->
						{#if tab.recurrence.length > 0}
							<ul class="offender-recurrence" data-slot="offender-recurrence">
								{#each tab.recurrence as line (line.key)}
									<li class="offender-recurrence-item">
										<span class="offender-recurrence-label">{line.label}</span>
										<span class="offender-recurrence-text">{line.text}</span>
									</li>
								{/each}
							</ul>
						{/if}
					{:else}
						<!-- This kind served only sub-MIN_N entities (tray, below) — no ranked ladder. -->
						<div class="offender-section-head">
							<SectionHeading level={2} overline={heading} />
						</div>
						<div data-slot="offender-ladder-empty">
							<AbsentValue variant="block" reason="no-observations" {locale} />
						</div>
					{/if}

					<!-- The un-ranked tray: sub-MIN_N entities that EXIST but can't be ranked. Shown
					     for transparency, never scored. -->
					{#if tab.tray.length > 0}
						<div class="offender-tray" data-slot="offender-tray">
							<SectionHeading level={3} overline={t.tray.heading} />
							<p class="caption" data-slot="offender-tray-reason">{t.tray.reason}</p>
							<ul class="offender-tray-list" aria-label={t.tray.listLabel}>
								{#each tab.tray as row (row.key)}
									<li class="offender-tray-item">
										{#if row.href}
											<a
												class="offender-tray-link"
												href={row.href}
												data-sveltekit-preload-data="hover"
												aria-label={row.ariaLabel}
												data-testid="offender-tray-link"
											>
												<span class="offender-tray-title">{row.title}</span>
												<span class="offender-tray-subtitle">{row.subtitle}</span>
											</a>
										{:else}
											<span class="offender-tray-title">{row.title}</span>
											<span class="offender-tray-subtitle">{row.subtitle}</span>
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</TabsContent>
			{/each}
		</Tabs>
	{:else}
		<!-- Whole-section honest empty: this grain served no ranked entry of EITHER kind. -->
		<div class="offender-section-head">
			<SectionHeading level={2} overline={heading} />
		</div>
		<div data-slot="offender-ladder-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{/if}
</section>

<style>
	.offender-section {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	:global(.offender-tab-pane) {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding-top: 1rem;
	}
	/* Heading row: the label + (i) on the left, the worst-N selector on the right;
	   wraps to its own row on narrow/mobile so the selector never crowds the heading. */
	.offender-section-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}
	.caption {
		margin: 0;
		max-width: 52ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* The metro-signage active tab (yesid StationTabs parity). */
	.station-tab {
		min-width: max-content;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		padding: 0.5rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		background: transparent;
		border: none;
		border-bottom: 3px solid transparent;
		transition:
			color var(--duration-fast) var(--ease-out),
			background var(--duration-fast) var(--ease-out);
	}
	.station-tab:hover {
		color: var(--foreground);
	}
	.station-tab.active {
		background: var(--signage-bg);
		color: var(--signage-text);
		border-bottom-color: var(--signage-text);
		font-weight: 700;
	}
	.station-tab:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
		border-radius: var(--radius-sm);
	}
	@media (prefers-reduced-motion: reduce) {
		.station-tab {
			transition: none;
		}
	}
	/* The visible recurrence lines — a quiet mono list under the ladder, one per row. */
	.offender-recurrence {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.offender-recurrence-item {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.offender-recurrence-label {
		color: var(--foreground);
	}
	/* The un-ranked tray — a quiet block, visually subordinate to the ladder. */
	.offender-tray {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px dashed var(--border);
	}
	.offender-tray-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.offender-tray-item {
		display: block;
	}
	.offender-tray-link {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem;
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: inherit;
	}
	.offender-tray-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.offender-tray-title {
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.offender-tray-subtitle {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
</style>
