<!--
  EasterProse — renders a prose string with the tasteful /metrics "easter word"
  flourish (D4). Splits the text ONCE on mount (via splitEasterSegments, a pure
  matcher) into plain runs + matched words; each matched word is wrapped in a
  <span> carrying use:easterWordHover, which rotates the house wordmark effect
  family (bounce / wiggle / wave / spin) on hover.

  DECORATION ONLY: the text stays exactly the input (lossless split), fully
  selectable and readable; the animation is a hover flourish the action self-
  disables on touch + under prefers-reduced-motion (those readers get plain text,
  and GSAP is never fetched). Zero layout shift — the split chars only transform.
  The matched span is a plain <span> (no href, no role), so screen readers read
  the prose verbatim. Processing happens ONCE at mount (the segments derive from
  the text prop, not per frame).

  Usage: <EasterProse text={entry.definition[locale]} class="metric__prose" />
  Drop-in for a <p class="metric__prose">{text}</p>.
-->
<script lang="ts">
	import { easterWordHover } from './easterWordHover';
	import { splitEasterSegments } from './easterWords';

	interface Props {
		/** The prose to render (decorated in place). */
		text: string;
		/** Class(es) for the wrapping <p>. */
		class?: string;
	}

	let { text, class: className }: Props = $props();

	// Split once per text value (re-derives only on a locale/text change, never per
	// frame). Each matched span gets a stable per-occurrence effect seed so adjacent
	// words do not all fire the same first effect.
	const segments = $derived(splitEasterSegments(text));
</script>

<p class={className} data-slot="easter-prose">
	{#each segments as seg, i (i)}{#if seg.match}<span
				class="easter-word"
				use:easterWordHover={{ startEffect: i }}>{seg.text}</span
			>{:else}{seg.text}{/if}{/each}
</p>

<style>
	/* The matched word: a barely-there brand cue (a dotted primary underline that
	   only lifts on hover/focus-within), so it reads as a live, playful word without
	   shouting. Inline so it never breaks the prose flow; the flourish is motion, not
	   layout. Under reduced motion the action does not animate; the underline stays. */
	.easter-word {
		display: inline-block;
		color: inherit;
		text-decoration: underline dotted color-mix(in srgb, var(--primary) 55%, transparent);
		text-underline-offset: 0.15em;
		text-decoration-thickness: 1px;
		cursor: default;
		/* Isolate the GSAP transforms so split-char animation never nudges neighbors. */
		will-change: transform;
	}
	.easter-word:hover {
		text-decoration-color: var(--primary);
	}
	@media (prefers-reduced-motion: reduce) {
		.easter-word {
			will-change: auto;
		}
	}
</style>
