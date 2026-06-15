<!--
  Stop surface — tabbed detail for one stop.

  ROUTING backbone (slice-9.2): the page resolves /stop/{id} (and /fr/stop/{id}),
  reads the stop id + locale from +page.ts, and lays out the four canonical tabs
  — Prochains (next departures) / Horaire (schedule) / Info / Fiabilité
  (reliability). Each pane renders an EdgeState placeholder; the stop feature
  slice wires the real /v1 reads into these panes later.

  Tabs use the bits-ui ui/tabs primitive (bind:value). Brand StopLabel heads the
  surface. Tokens only; the edge-state density tracks the shell breakpoint.
-->
<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { layout } from '$lib/nav';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { EdgeState } from '$lib/components/edge';
	import StopLabel from '$lib/components/brand/StopLabel.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const locale: Locale = getLocale();
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	type TabKey = 'next' | 'schedule' | 'info' | 'reliability';

	const TAB_LABELS: Record<TabKey, Record<Locale, string>> = {
		next: { fr: 'Prochains', en: 'Next' },
		schedule: { fr: 'Horaire', en: 'Schedule' },
		info: { fr: 'Info', en: 'Info' },
		reliability: { fr: 'Fiabilité', en: 'Reliability' },
	};

	const TABS: readonly TabKey[] = ['next', 'schedule', 'info', 'reliability'];

	const KICKER: Record<Locale, string> = { fr: 'ARRÊT', en: 'STOP' };

	let active = $state<TabKey>('next');
</script>

<section class="surface">
	<header class="surface-head">
		<SectionLabel text={KICKER[locale]} variant="station" />
		<StopLabel stop={data.id} label={`#${data.id}`} />
	</header>

	<Tabs bind:value={active} class="surface-tabs">
		<TabsList variant="line" class="w-full justify-start">
			{#each TABS as key (key)}
				<TabsTrigger value={key}>{TAB_LABELS[key][locale]}</TabsTrigger>
			{/each}
		</TabsList>

		{#each TABS as key (key)}
			<TabsContent value={key} class="surface-pane">
				<!-- Placeholder until the stop feature slice wires /v1 into this pane. -->
				<EdgeState variant="empty" lang={locale} layout={edgeLayout} />
			</TabsContent>
		{/each}
	</Tabs>
</section>

<style>
	.surface {
		max-width: var(--width-content);
		margin-inline: auto;
		padding: clamp(1.5rem, 4vw, 2.5rem) var(--space-page-x, 1.5rem);
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.surface-head {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	:global(.surface-pane) {
		padding-top: 1.25rem;
	}
</style>
