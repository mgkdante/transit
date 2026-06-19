<!--
  MarkerGlyph — the DOM twin of the baked map sprites (components/map/vehicleSprites.ts).
  The filter legend must show the SAME pictograms the user sees on the map (a
  bus-front and a stop map-pin), not a generic shape glyph — so this mirrors the
  sprite geometry in SVG: viewBox 0 0 26 26 == the sprite's SIZE box, same body /
  windshield / headlight / teardrop proportions.

  Painted with `currentColor` (the caller sets the entity hue: bus = --primary,
  stop = --map-stop-fill). The knocked-out parts (windshield, headlights, pin
  hole) use --marker-glyph-cut (defaults to the panel surface --card) so they
  read as cut-outs exactly like the sprite's halo cut.
-->
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
		<!-- Bus-front: a tall rounded body, a windshield band, two headlights. -->
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
		<!-- Stop map-pin: a teardrop with a knocked-out hole (reads hollow). -->
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
