<script lang="ts">
	import CollapsibleSection from './CollapsibleSection.svelte';
	import SectionIcon from './SectionIcon.svelte';
	import { TocBadge } from '@yesid/ui/brand';
	import { resolveTocCounter, type TocEntry } from './toc';

	let {
		entries,
		activeId,
		onNavigate,
		heading,
		counterPrefix = 'SEC',
		collapsible = true,
		open = $bindable(true),
		sectionKey = undefined,
		closeSignal = null,
		openSignal = null,
		bulkCollapsed = null,
	}: {
		entries: TocEntry[];
		activeId: string;
		onNavigate: (id: string) => void;
		heading: string;
		counterPrefix?: string;
		open?: boolean;
		collapsible?: boolean;
		sectionKey?: string;
		closeSignal?: number | null;
		openSignal?: number | null;
		bulkCollapsed?: boolean | null;
	} = $props();

	const shown = $derived(entries.filter((e) => !e.rail));
	const counter = $derived(resolveTocCounter(shown, activeId));
</script>

<CollapsibleSection
	title={heading}
	{collapsible}
	{sectionKey}
	{closeSignal}
	{openSignal}
	{bulkCollapsed}
	bind:open
>
	{#snippet icon()}
		<SectionIcon name="toc" class="h-4 w-4 shrink-0 text-primary" />
	{/snippet}
	<nav class="toc-nav">
		{#each shown as entry (entry.id)}
			<button
				class="tap-press toc-item"
				class:active={activeId === entry.id}
				aria-current={activeId === entry.id ? 'location' : undefined}
				onclick={() => onNavigate(entry.id)}
			>
				<span class="toc-badge"
					><TocBadge badge={entry.badge} iconClass="h-3.5 w-3.5 shrink-0 text-primary" /></span
				>
				<span class="toc-label">{entry.title}</span>
			</button>
			{#each entry.children as child (child.id)}
				<button
					class="tap-press toc-item toc-sub-item"
					class:active={activeId === child.id}
					aria-current={activeId === child.id ? 'location' : undefined}
					onclick={() => onNavigate(child.id)}
					style="padding-left: {18 + Math.max(0, child.level - 3) * 10}px;"
				>
					<span class="toc-label">{child.title}</span>
				</button>
			{/each}
		{/each}
	</nav>

	<div class="mt-6 flex items-center gap-2">
		<div class="toc-counter-dot"></div>
		<span class="toc-counter-text font-mono text-micro tracking-[1.5px]">
			{counterPrefix}
			{String(counter.current).padStart(2, '0')} / {String(counter.total).padStart(2, '0')}
		</span>
	</div>
</CollapsibleSection>

<style>
	.toc-nav {
		font-family: var(--font-heading);
		font-size: var(--text-body);
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.toc-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		min-height: 44px;
		color: var(--muted-foreground);
		transition: color var(--duration-fast) var(--ease-default);
	}

	.toc-item:hover {
		color: color-mix(in srgb, var(--foreground) 60%, transparent);
	}

	.toc-item.active {
		color: var(--primary);
		font-weight: 600;
	}

	.toc-item:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: 2px;
	}

	.toc-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.5rem;
		flex-shrink: 0;
	}

	.toc-label {
		min-width: 0;
		flex: 1;
	}

	.toc-sub-item {
		font-size: var(--text-caption);
		min-height: 36px;
		color: color-mix(in srgb, var(--foreground) 20%, transparent);
	}

	.toc-sub-item:hover {
		color: color-mix(in srgb, var(--foreground) 50%, transparent);
	}

	.toc-sub-item.active {
		color: var(--primary);
	}

	.toc-counter-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--primary);
	}

	.toc-counter-text {
		color: var(--muted-foreground);
	}
</style>
