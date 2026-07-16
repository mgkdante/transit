<script lang="ts">
	import EntityDetail from '../EntityDetail.svelte';
	import type { TocEntry } from '$lib/components/shared/toc';
	import { ReliabilityRailLayout } from '$lib/components/layout';

	type TabKey = 'detail' | 'schedule' | 'reliability';

	let {
		mode = 'classic',
		sectionKey = 'entity-detail-harness-toc',
		withBanner = true,
	}: {
		mode?: 'classic' | 'article';
		sectionKey?: string;
		withBanner?: boolean;
	} = $props();
	let active = $state<TabKey>('detail');

	const tabs = [
		{ key: 'detail', label: 'Detail' },
		{ key: 'schedule', label: 'Schedule' },
		{ key: 'reliability', label: 'Reliability' },
	] as const;
	const articleTocEntries: Partial<Record<TabKey, TocEntry[]>> = {
		detail: [{ id: 'detail-section', title: 'Detail section', level: 2, children: [] }],
		schedule: [{ id: 'schedule-section', title: 'Schedule section', level: 2, children: [] }],
	};
</script>

{#snippet articleHeader()}
	<header data-testid="article-cover">
		<a href="/lines">Article back</a>
		<h1>24 Sherbrooke</h1>
	</header>
{/snippet}

{#snippet classicHeader()}
	<h1 data-testid="classic-header">Line 24</h1>
{/snippet}

{#snippet banner()}
	<div>Service banner</div>
{/snippet}

{#snippet reliabilityRail()}
	<nav aria-label="Reliability controls">Reliability controls</nav>
{/snippet}

{#snippet reliabilityContent()}
	<section data-toc="reliability-section">
		<p>Reliability pane</p>
	</section>
{/snippet}

{#snippet pane(key: TabKey)}
	{#if key === 'reliability'}
		<ReliabilityRailLayout
			rail={reliabilityRail}
			content={reliabilityContent}
			articleSummary={mode === 'article' && withBanner && active === 'reliability'
				? banner
				: undefined}
			label="Reliability controls"
			openAria="Open reliability controls"
			closeAria="Close reliability controls"
		/>
	{:else}
		<section data-toc={`${key}-section`}>
			<p>{key === 'detail' ? 'Detail pane' : 'Schedule pane'}</p>
		</section>
	{/if}
{/snippet}

{#if mode === 'article'}
	<EntityDetail
		{articleHeader}
		banner={withBanner ? banner : undefined}
		{tabs}
		bind:active
		{pane}
		paneOwnedRailKeys={['reliability']}
		articleToc={{
			entries: articleTocEntries,
			heading: 'On this page',
			sectionKey,
			openAria: 'Open contents',
			closeAria: 'Close contents',
		}}
	/>
{:else}
	<EntityDetail
		kicker="LINE"
		header={classicHeader}
		banner={withBanner ? banner : undefined}
		{tabs}
		bind:active
		{pane}
		back={{ href: '/lines', label: 'Back to lines' }}
	/>
{/if}

<output data-testid="active-tab">{active}</output>
