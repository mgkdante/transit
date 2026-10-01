<script lang="ts">
	interface Props {
		kind: 'bus' | 'stop';
		class?: string;
	}
	let { kind, class: className = '' }: Props = $props();
</script>

<svg
	class="marker-glyph {className}"
	viewBox="0 0 26 26"
	fill="none"
	role="presentation"
	aria-hidden="true"
>
	{#if kind === 'bus'}
		<rect x="6.5" y="3.5" width="13" height="19" rx="4" fill="currentColor" />
		<rect
			x="8.9"
			y="5.9"
			width="8.2"
			height="5.6"
			rx="2"
			fill="var(--marker-glyph-cut, var(--card))"
		/>
		<circle cx="9.1" cy="19" r="1.25" fill="var(--marker-glyph-cut, var(--card))" />
		<circle cx="16.9" cy="19" r="1.25" fill="var(--marker-glyph-cut, var(--card))" />
	{:else}
		<path
			d="M13 22.5C9.3 17.9 6.4 14.2 6.4 10.4 6.4 6.7 9.4 4 13 4s6.6 2.7 6.6 6.4c0 3.8-2.9 7.5-6.6 12.1Z"
			fill="currentColor"
		/>
		<circle cx="13" cy="10.4" r="2.5" fill="var(--marker-glyph-cut, var(--card))" />
	{/if}
</svg>

<style>
	.marker-glyph {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
