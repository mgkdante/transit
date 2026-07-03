<!--
  HotspotSection — one grain's worst-N ladder, split into route|stop TABS (WEB2).

  A PURE presenter (mirrors Section4WorstStops): the orchestrator ranks route and stop
  on SEPARATE per-kind ladders (rank restarts per kind) and hands this file one built
  ladder + tray PER KIND. This section renders the two kinds as tabs on the tabs
  primitive (the yesid StationTabs look via EntityDetail's pattern), each tab showing
  its own MagnitudeBarsSpec lollipop on the ABSOLUTE SEVERE_DOMAIN [0,100], the honest
  per-kind shown/total heading, the worst-N GrainPicker, the trailing-window caption,
  and the kind's un-ranked tray. Tab state is LOCAL (the FIX-2 note: no ?kind param
  needed — like other in-page tabs); worstN binds UP to the orchestrator's codec-seeded
  value; the specs arrive built. This file owns NO math and NO cross-surface state.

  HONESTY: a kind with no ranked entry (shown === 0) degrades to the styled AbsentValue
  chip (says WHY), never a fake 0; a null severe_pct row draws MagnitudeBars' own no-data
  swatch. The tray is a quiet AbsentValue-styled list — the cells exist but sit below the
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
	import type { HotspotLadderResult } from '../selectors/hotspotLadder';
	import { worstNSegments, SMALLEST_WORST_N } from '../data/ladderCap';
	import type { HotspotsCopy } from '../hotspots.copy';

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

	type KindKey = 'route' | 'stop';

	interface HotspotSectionProps {
		/** Section heading (a city/provider label when grouped, else the ladder heading). */
		heading: string;
		/** The route-kind ladder spec + total/shown (from selectHotspotLadder). */
		routeLadder: HotspotLadderResult;
		/** The stop-kind ladder spec + total/shown. */
		stopLadder: HotspotLadderResult;
		/** The route-kind un-ranked tray rows (sub-MIN_N cells) — already mapped. */
		routeTray: readonly TrayRow[];
		/** The stop-kind un-ranked tray rows. */
		stopTray: readonly TrayRow[];
		/** The trailing-window caption for the active grain. */
		windowCaption: string;
		/** The (i) metric explainer VM for the severe-rate column. */
		info: MetricInfoVM;
		/** The codec-owned worst-N cap (BINDABLE — owner is the orchestrator). */
		worstN: WorstN;
		locale: Locale;
		copy: HotspotsCopy;
	}
	let {
		heading,
		routeLadder,
		stopLadder,
		routeTray,
		stopTray,
		windowCaption,
		info,
		worstN = $bindable(),
		locale,
		copy,
	}: HotspotSectionProps = $props();

	const t = $derived(copy);
	const segments = $derived<GrainSegment<WorstN>[]>(worstNSegments(t.worstN.all));

	// One tab per kind. A kind is OFFERED only when it serves at least one ranked entry
	// OR a tray row — a kind with nothing at all is never a dead tab.
	interface KindTab {
		readonly key: KindKey;
		readonly label: string;
		readonly ladder: HotspotLadderResult;
		readonly tray: readonly TrayRow[];
	}
	const allTabs = $derived<KindTab[]>([
		{ key: 'route', label: t.type.route, ladder: routeLadder, tray: routeTray },
		{ key: 'stop', label: t.type.stop, ladder: stopLadder, tray: stopTray },
	]);
	const tabs = $derived(allTabs.filter((tab) => tab.ladder.shown > 0 || tab.tray.length > 0));

	// LOCAL tab state (FIX-2: no ?kind param — like other in-page tabs). Default to the
	// first OFFERED kind so the active tab is always populated; re-clamp if the offered
	// set changes (e.g. a grain switch drops the active kind).
	let active = $state<KindKey>('route');
	$effect(() => {
		if (tabs.length > 0 && !tabs.some((tab) => tab.key === active)) active = tabs[0].key;
	});

	// The worst-N control is dead when the active kind's full ranked set is smaller than
	// the smallest rung — render it only when there's something to cap (the S7 total > 5 gate).
	function showWorstNFor(l: HotspotLadderResult): boolean {
		return l.total > SMALLEST_WORST_N;
	}
	// Honest shown/total heading suffix (only when the cap actually truncated).
	function headingTextFor(l: HotspotLadderResult): string {
		return l.total > l.shown ? `${heading} ${t.shownOfTotal(l.shown, l.total)}` : heading;
	}
</script>

<section class="hotspot-section" data-slot="hotspot-section">
	{#if tabs.length > 0}
		<Tabs bind:value={active}>
			<!-- overflow-x:auto (P5.3d §C4 P10): the Line/Stop tab strip scrolls
			     rather than clips at narrow widths. -->
			<TabsList variant="line" class="w-full flex-nowrap justify-start overflow-x-auto">
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
				<TabsContent value={tab.key} class="hotspot-tab-pane">
					{#if tab.ladder.shown > 0}
						<div class="hotspot-section-head">
							<SectionHeading level={2} overline={headingTextFor(tab.ladder)}>
								{#snippet explainer()}
									<MetricInfo
										class="hotspot-info"
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
						<p class="caption" data-slot="hotspot-window">{windowCaption}</p>
						<div data-slot="hotspot-ladder">
							<Chart spec={tab.ladder.spec} />
						</div>
					{:else}
						<!-- This kind served only sub-MIN_N cells (tray, below) — no ranked ladder. -->
						<div class="hotspot-section-head">
							<SectionHeading level={2} overline={heading} />
						</div>
						<div data-slot="hotspot-ladder-empty">
							<AbsentValue variant="block" reason="no-observations" {locale} />
						</div>
					{/if}

					<!-- The un-ranked tray: sub-MIN_N cells that EXIST but can't be ranked. Shown
					     for transparency, never scored. -->
					{#if tab.tray.length > 0}
						<div class="hotspot-tray" data-slot="hotspot-tray">
							<SectionHeading level={3} overline={t.tray.heading} />

							<p class="caption" data-slot="hotspot-tray-reason">{t.tray.reason}</p>
							<ul class="hotspot-tray-list" aria-label={t.tray.listLabel}>
								{#each tab.tray as row (row.key)}
									<li class="hotspot-tray-item">
										{#if row.href}
											<a
												class="hotspot-tray-link"
												href={row.href}
												data-sveltekit-preload-data="hover"
												aria-label={row.ariaLabel}
												data-testid="hotspot-tray-link"
											>
												<span class="hotspot-tray-title">{row.title}</span>
												<span class="hotspot-tray-subtitle">{row.subtitle}</span>
											</a>
										{:else}
											<span class="hotspot-tray-title">{row.title}</span>
											<span class="hotspot-tray-subtitle">{row.subtitle}</span>
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
		<div class="hotspot-section-head">
			<SectionHeading level={2} overline={heading} />
		</div>
		<div data-slot="hotspot-ladder-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{/if}
</section>

<style>
	.hotspot-section {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	:global(.hotspot-tab-pane) {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding-top: 1rem;
	}
	/* Heading row: the label + (i) on the left, the worst-N selector on the right;
	   wraps to its own row on narrow/mobile so the selector never crowds the heading. */
	.hotspot-section-head {
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
	/* The metro-signage active tab (yesid StationTabs parity — same as EntityDetail). */
	.station-tab {
		min-width: max-content;
		/* Tap-target floor (P5.3d §C4 P10): 41px → 44px. */
		min-height: var(--size-tap-min);
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
	/* The un-ranked tray — a quiet block, visually subordinate to the ladder. */
	.hotspot-tray {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px dashed var(--border);
	}
	.hotspot-tray-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.hotspot-tray-item {
		display: block;
	}
	.hotspot-tray-link {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem;
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: inherit;
	}
	.hotspot-tray-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.hotspot-tray-title {
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.hotspot-tray-subtitle {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
</style>
