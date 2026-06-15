<!--
  Route (line) surface — tabbed detail for one line.

  ROUTING backbone (slice-9.2): the page resolves /route/{id} (and /fr/route/{id}),
  reads the route id + locale from +page.ts, and lays out the three canonical
  tabs — Détail (detail) / Horaire (schedule) / Fiabilité (reliability). Each
  pane renders an EdgeState placeholder; the line feature slice wires the real
  /v1 reads into these panes later.

  Tabs use the bits-ui ui/tabs primitive (bind:value). Tokens only; the
  edge-state density tracks the shell breakpoint.
-->
<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { layout } from '$lib/nav';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { EdgeState } from '$lib/components/edge';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const locale: Locale = getLocale();
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	type TabKey = 'detail' | 'schedule' | 'reliability';

	const TAB_LABELS: Record<TabKey, Record<Locale, string>> = {
		detail: { fr: 'Détail', en: 'Detail' },
		schedule: { fr: 'Horaire', en: 'Schedule' },
		reliability: { fr: 'Fiabilité', en: 'Reliability' },
	};

	const TABS: readonly TabKey[] = ['detail', 'schedule', 'reliability'];

	const KICKER: Record<Locale, string> = { fr: 'LIGNE', en: 'LINE' };

	let active = $state<TabKey>('detail');
</script>

<section class="surface">
	<header class="surface-head">
		<SectionLabel text={KICKER[locale]} variant="station" />
		<SectionHeading heading={data.id} level={1} dot />
	</header>

	<Tabs bind:value={active} class="surface-tabs">
		<TabsList variant="line" class="w-full justify-start">
			{#each TABS as key (key)}
				<TabsTrigger value={key}>{TAB_LABELS[key][locale]}</TabsTrigger>
			{/each}
		</TabsList>

		{#each TABS as key (key)}
			<TabsContent value={key} class="surface-pane">
				<!-- Placeholder until the line feature slice wires /v1 into this pane. -->
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
