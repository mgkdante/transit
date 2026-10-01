<script lang="ts">
	import { easterWordHover } from './easterWordHover';
	import { splitEasterSegments } from './easterWords';

	interface Props {
		text: string;
		class?: string;
	}

	let { text, class: className }: Props = $props();

	const segments = $derived(splitEasterSegments(text));
</script>

<p class={className} data-slot="easter-prose">
	{#each segments as seg, i (i)}{#if seg.match}<span
				class="easter-word"
				data-easter-effect={i}
				use:easterWordHover={{ startEffect: i }}>{seg.text}</span
			>{:else}{seg.text}{/if}{/each}
</p>

<style>
	.easter-word {
		display: inline-block;
		color: inherit;
		text-decoration: underline dotted color-mix(in srgb, var(--primary) 55%, transparent);
		text-underline-offset: 0.15em;
		text-decoration-thickness: 1px;
		cursor: default;
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
