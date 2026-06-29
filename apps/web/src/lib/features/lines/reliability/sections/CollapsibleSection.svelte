<!--
  CollapsibleSection — the shared shell for the five rider-question sections (review polish).

  Renders the section's eyebrow + DISPLAY-scale title as a collapse TOGGLE, and the section body
  inside a smooth collapsible region (the same bits-ui Collapsible + grid-rows animation as Detail).
  Open by default (the full view is the default experience); collapse is opt-in so a rider can
  glance the five section titles + open them one at a time. The title styling is inherited from the
  orchestrator's `:global(.reliability-band .section-question)` rule, so the big-title look is kept.

  a11y: the toggle is a real <button> with aria-expanded + aria-controls (bits-ui wires it); the
  whole header is the click target (Label-in-Name — the visible title IS the accessible name).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		Collapsible,
		CollapsibleTrigger,
		CollapsibleContent,
	} from '$lib/components/ui/collapsible';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { ChevronToggle } from '$lib/components/brand';

	interface CollapsibleSectionProps {
		/** Mono eyebrow (e.g. "WHEN TO RIDE"). */
		eyebrow: string;
		/** The plain-language DISPLAY-scale section title (the toggle's accessible name). */
		question: string;
		/** `data-section` token for wayfinding / tests (e.g. "when-to-ride"). */
		dataSection: string;
		/** Open by default; bindable so a caller could persist/seed it later. */
		open?: boolean;
		/** The section body. */
		children: Snippet;
	}
	let {
		eyebrow,
		question,
		dataSection,
		open = $bindable(true),
		children,
	}: CollapsibleSectionProps = $props();
</script>

<section class="section" data-section={dataSection} aria-label={eyebrow}>
	<Collapsible bind:open>
		<CollapsibleTrigger>
			{#snippet child({ props })}
				<!-- A real <h2> wraps the disclosure button (the WAI accordion pattern) so screen-reader
				     heading navigation reaches every section (WCAG 1.3.1 / 2.4.10); the display-scale
				     look stays on .section-question. -->
				<h2 class="section-heading">
					<button {...props} type="button" class="section-toggle" data-slot="section-toggle">
						<span class="section-head-text">
							<SectionLabel text={eyebrow} variant="station" />
							<span class="section-question" data-slot="section-question">{question}</span>
						</span>
						<ChevronToggle {open} direction="down" size="md" />
					</button>
				</h2>
			{/snippet}
		</CollapsibleTrigger>
		<CollapsibleContent>
			<div class="section-body" data-slot="section-body">{@render children()}</div>
		</CollapsibleContent>
	</Collapsible>
</section>

<style>
	.section {
		display: flex;
		flex-direction: column;
		width: 100%;
	}
	/* The heading wraps the toggle (WAI accordion) — reset the UA heading box so the visual
	   look is unchanged; the title styling lives on .section-question. */
	.section-heading {
		margin: 0;
		font: inherit;
		color: inherit;
	}
	/* The whole header (eyebrow + big title) IS the toggle — a full-width, transparent button so
	   the click target is generous + the title keeps its display-scale look. The chevron is the
	   secondary affordance. */
	.section-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		width: 100%;
		padding: 0;
		text-align: start;
		background: none;
		border: none;
		cursor: pointer;
		color: inherit;
	}
	.section-toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
		border-radius: var(--radius-md, 0.5rem);
	}
	.section-head-text {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.section-toggle :global([data-slot='chevron-toggle']) {
		flex: none;
		color: var(--muted-foreground);
	}
	/* The body keeps the section's internal rhythm + a clear gap below the toggle. The collapsible
	   wrapper clips this when closed, so the gap only shows when open. */
	.section-body {
		display: flex;
		flex-direction: column;
		gap: clamp(1.25rem, 3vw, 2rem);
		padding-top: clamp(1rem, 2.5vw, 1.5rem);
	}
</style>
