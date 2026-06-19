<!--
  TocNav - the desktop table-of-contents card. Shared across detail pages: a
  CollapsibleSection wrapper + a badge-led nav + a "section N / total" counter.
  Badges come from TocBadge (same marks as the section cards). The page owns the
  active id + scroll handler and passes them in.

  Ported from yesid.dev shared/TocNav. Deviation: yesid's `.toc-counter-dot`
  glow uses `--glow` (a token transit lacks). Substituted `--primary` (transit's
  interactive orange) as the closest existing token; see the new-token report.
-->
<script lang="ts">
	import CollapsibleSection from './CollapsibleSection.svelte';
	import SectionIcon from './SectionIcon.svelte';
	import TocBadge from './TocBadge.svelte';
	import { flattenToc, type TocEntry } from './toc';

	let {
		entries,
		activeId,
		onNavigate,
		heading,
		sectionKey,
		counterPrefix = 'SEC',
	}: {
		entries: TocEntry[];
		activeId: string;
		onNavigate: (id: string) => void;
		heading: string;
		/** Unique persisted-open-state key for this TOC instance. */
		sectionKey: string;
		counterPrefix?: string;
	} = $props();

	// Desktop TOC lists only the center-column sections; right-rail cards
	// (rail:true) are already visible in the sticky rail, so they are excluded
	// here. They DO appear in the mobile pill, where they sit in the page flow.
	const shown = $derived(entries.filter((e) => !e.rail));
	const flat = $derived(flattenToc(shown));
	const activeIndex = $derived(
		Math.max(
			0,
			flat.findIndex((e) => e.id === activeId),
		),
	);
</script>

<CollapsibleSection title={heading} {sectionKey} open={true}>
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
			{activeIndex + 1} / {flat.length}
		</span>
	</div>
</CollapsibleSection>

<style>
	.toc-nav {
		font-family: var(--font-heading);
		font-size: 16px;
		border-left: 2px solid color-mix(in srgb, var(--primary) 12%, transparent);
		padding-left: 14px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.toc-item {
		display: flex;
		align-items: center;
		gap: 0.55rem;
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

	/* Fixed-width badge slot keeps every label left-aligned whether the entry
	   carries a number pill, an icon, or (sub-items) nothing. */
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
		/* padding-left set inline based on heading depth */
		font-size: 13px;
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
		box-shadow: 0 0 8px color-mix(in srgb, var(--glow) 40%, transparent);
	}

	.toc-counter-text {
		color: color-mix(in srgb, var(--primary) 30%, transparent);
	}
</style>
