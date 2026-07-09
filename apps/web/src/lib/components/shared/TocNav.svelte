<!--
  TocNav - the desktop table-of-contents rail. Shared across detail pages: a
  badge-led nav + a "section N / total" counter, wrapped in a CollapsibleSection.
  Badges come from TocBadge (same marks as the section cards). The page owns the
  active id + scroll handler and passes them in.

  COLLAPSE CONTRACT (slice-9.8-B → REVISED S10 2026-07-02): the ToC keeps its
  OWN, USER-DRIVEN collapse affordance (its own chevron) — a reader can manually
  fold the rail and, when a `sectionKey` is supplied, that collapsed choice
  persists across same-tab visits.

  S10 UPDATE (was: "FOCUS NEVER touches the ToC"): the /metrics FOCUS parity pass
  reconciled transit to yesid's Quiet-Mode contract, where the ToC's own
  CollapsibleSection DOES respond to the page's quiet signals (yesid TocNav →
  CollapsibleSection subscribes to closeSignal/openSignal). Transit now matches:
  a page may pass `closeSignal` (fold the rail on FOCUS) + `openSignal` (reopen it
  on unfocus). When neither is wired the rail stays Focus-independent exactly as
  before (both default `null`). The reader's manual chevron still works and still
  persists; the signals are edge-triggered so they never fight a fresh mount.
  Pass `collapsible={false}` for a permanently-open, non-hideable rail.

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
		counterPrefix = 'SEC',
		collapsible = true,
		sectionKey = undefined,
		closeSignal = null,
		openSignal = null,
	}: {
		entries: TocEntry[];
		activeId: string;
		onNavigate: (id: string) => void;
		heading: string;
		counterPrefix?: string;
		/**
		 * When true (default), the rail renders its OWN collapse affordance (chevron)
		 * so a reader can fold the navigation manually. This is the ToC's own toggle —
		 * it is NEVER driven by FOCUS/quiet mode (which collapses the section cards,
		 * not the ToC). Pass false to render a permanently-open, non-hideable rail.
		 */
		collapsible?: boolean;
		/**
		 * Opt the user-driven collapse state into surviving a same-tab navigation.
		 * When set, CollapsibleSection persists the open/closed choice keyed by this
		 * stable, locale-free string. Only meaningful when `collapsible` is true.
		 */
		sectionKey?: string;
		/**
		 * S10 FOCUS parity — optional "fold the rail" signal (yesid closeSignal idiom).
		 * When a page bumps it, the rail's CollapsibleSection collapses. `null`
		 * (default) keeps the rail Focus-independent. Forwarded verbatim to the wrapping
		 * CollapsibleSection.
		 */
		closeSignal?: number | null;
		/**
		 * S10 FOCUS parity — optional "reopen the rail" signal (yesid openSignal idiom).
		 * When a page bumps it, the rail reopens. `null` (default) keeps the rail
		 * Focus-independent. Forwarded verbatim to the wrapping CollapsibleSection.
		 */
		openSignal?: number | null;
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

<!--
	The ToC rail carries its OWN user-driven collapse (its own chevron). When
	`collapsible` is true (default) a reader can fold the rail, and a `sectionKey`
	persists that choice across same-tab visits. This toggle is the ToC's alone —
	it is never wired to FOCUS/quiet (which collapses the section cards, not this).
	Default-open so the nav is reachable until the reader chooses to fold it.
-->
<CollapsibleSection
	title={heading}
	{collapsible}
	{sectionKey}
	{closeSignal}
	{openSignal}
	open={true}
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

	<!-- THE one section-position readout for a rail (zero-padded to match the
	     numbered chips). SectionProgress was retired in P5.4f: every rail that
	     renders a TocNav gets exactly this counter, never a second one. -->
	<div class="mt-6 flex items-center gap-2">
		<div class="toc-counter-dot"></div>
		<span class="toc-counter-text font-mono text-micro tracking-[1.5px]">
			{counterPrefix}
			{String(activeIndex + 1).padStart(2, '0')} / {String(flat.length).padStart(2, '0')}
		</span>
	</div>
</CollapsibleSection>

<style>
	.toc-nav {
		font-family: var(--font-heading);
		/* P7: no left spine rule — the numbered chips + active state carry the outline. */
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
