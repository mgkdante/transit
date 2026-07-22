<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { localizeHref } from '$lib/i18n';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { SectionLabel } from '@yesid/ui/brand';
	import { HOME_PILLARS, type HomeCopy } from './home.copy';

	interface Props {
		readonly locale: Locale;
		readonly copy: HomeCopy;
	}

	let { locale, copy: t }: Props = $props();
</script>

<!-- 2. WHAT THIS IS — TWO columns (wayfinding v2): prose | ground rules. The
     rules are an INFORMATIONAL species — a legend seated against an amber rule,
     no card chassis, no hover, no CTA — visibly NOT the clickable destination
     cards below. Felt symmetry: real content mass on both sides, centered. -->
<section class="hub-what" aria-labelledby="hub-what-title">
	<div class="what-prose">
		<SectionHeading heading={t.whatTitle} subheading={t.whatSub} level={2} id="hub-what-title" />
		<p class="what-body">{t.whatBody}</p>
		<a class="what-link" href={localizeHref('/metrics', locale)}>
			<span aria-hidden="true">∑</span>
			{t.measureLink}
		</a>
	</div>

	<div class="what-pillars">
		<SectionLabel text={t.pillarsLabel} variant="station" />
		<ul class="pillar-list">
			{#each HOME_PILLARS as pillar (pillar.title.en)}
				<li class="pillar">
					<span class="pillar-glyph" aria-hidden="true">{pillar.glyph}</span>
					<span class="pillar-text">
						<span class="pillar-title">{pillar.title[locale]}</span>
						<span class="pillar-desc">{pillar.desc[locale]}</span>
					</span>
				</li>
			{/each}
		</ul>
	</div>
</section>

<style>
	/* ══ WHAT THIS IS — two columns: prose | informational ground rules ══════════
	   Wayfinding v2: the rules read as a LEGEND (amber left rule, aligned glyph
	   column, no chassis) so they cannot be mistaken for the clickable cards
	   below. Felt symmetry: both columns carry real mass and center on each
	   other; single column below 1024. */
	.hub-what {
		display: grid;
		grid-template-columns: 1fr;
		gap: 2.5rem;
	}
	@media (min-width: 1024px) {
		.hub-what {
			grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
			gap: clamp(2.5rem, 6vw, 5rem);
			align-items: center;
		}
	}
	/* §C5.1 hierarchy: the §2 heading steps DOWN a register so the hero thesis
	   stays the apex. Scoped; the shared primitive is untouched. */
	.hub-what :global(.section-heading-text) {
		font-size: clamp(1.875rem, 4vw, 2.75rem);
		font-weight: 800;
		letter-spacing: var(--tracking-tight);
	}
	/* The mono sub steps up with it (operator: the whole head reads bigger). */
	.hub-what :global(.section-heading-sub) {
		font-size: var(--text-small);
		margin-block-end: 0;
	}
	.what-prose {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	/* Legibility (operator 2026-07-10, round 2): bright secondary ink + generous
	   leading for readability, one step BELOW the first pass's heading scale —
	   "smaller" but never a muted caption. */
	.what-body {
		color: var(--secondary-foreground);
		font-size: var(--text-body);
		line-height: 1.65;
		max-width: 60ch;
	}
	.what-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		align-self: flex-start;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--primary);
		text-decoration: none;
		border-bottom: 1px solid transparent;
		transition: border-color var(--duration-fast) var(--ease-default);
	}
	.what-link:hover,
	.what-link:focus-visible {
		border-bottom-color: var(--primary);
	}
	.what-link:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 3px;
	}
	/* The ground rules — an INFORMATIONAL species: seated against a 1px amber
	   rule with an aligned mono glyph column, transparent ground, square edges,
	   no shadow, no hover, no cursor — none of the clickable-card cues (bordered
	   chassis, radius, lift, Open CTA) the destination tiles wear. */
	.what-pillars {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		border-left: 1px solid var(--line-amber);
		padding-left: clamp(1.25rem, 3vw, 2rem);
		min-width: 0;
	}
	.pillar-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.pillar {
		display: grid;
		grid-template-columns: 2.75rem minmax(0, 1fr);
		column-gap: 0.875rem;
		align-items: start;
	}
	.pillar-glyph {
		font-family: var(--font-mono);
		font-size: 1.75rem;
		line-height: 1.15;
		color: var(--accent-text);
	}
	.pillar-text {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.pillar-title {
		font-family: var(--font-heading);
		font-weight: 700;
		font-size: var(--text-subheading);
		line-height: 1.2;
	}
	.pillar-desc {
		color: var(--muted-foreground);
		font-size: var(--text-body);
		line-height: 1.55;
	}

	@media (prefers-reduced-motion: reduce) {
		.what-link {
			transition: none;
		}
	}
</style>
