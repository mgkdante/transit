<script lang="ts" module>
 export interface ConstructionFloodlightProps { lit?: boolean; }
</script>
<script lang="ts">let { lit = false }: ConstructionFloodlightProps = $props();</script>
<svg data-slot="construction-floodlight" data-lit={lit} aria-hidden="true" focusable="false" viewBox="0 0 64 52" fill="none">
		<!-- Tripod legs -->
		<line x1="32" y1="30" x2="10" y2="50" stroke="#555" stroke-width="2.5" stroke-linecap="round"/>
		<line x1="32" y1="30" x2="54" y2="50" stroke="#555" stroke-width="2.5" stroke-linecap="round"/>
		<!-- Rear leg (shorter, angled back) -->
		<line x1="32" y1="30" x2="32" y2="50" stroke="#4a4a4a" stroke-width="2" stroke-linecap="round"/>
		<!-- Feet -->
		<rect x="6" y="48" width="8" height="3" rx="1" fill="#444"/>
		<rect x="50" y="48" width="8" height="3" rx="1" fill="#444"/>
		<rect x="29" y="48" width="6" height="3" rx="1" fill="#3a3a3a"/>
		<!-- Vertical mast -->
		<line x1="32" y1="30" x2="32" y2="14" stroke="#555" stroke-width="3.5" stroke-linecap="round"/>
		<!-- Pivot joint -->
		<circle cx="32" cy="14" r="3" fill="#444" stroke="#555" stroke-width="1"/>
		<!-- Light head housing (trapezoid pointing up) -->
		<path d="M21,14 L43,14 L38,2 L26,2 Z" fill="#333" stroke="#444" stroke-width="0.5"/>
		<!-- Reflector interior -->
		<path d="M24,12 L40,12 L37,4 L27,4 Z" fill="#2a2a2a"/>
		<!-- Light lens (top face, glowing) -->
		<rect x="26" y="1" width="12" height="3" rx="1" fill={lit ? 'var(--accent)' : '#777'}/>
		<rect x="27.5" y="1.5" width="9" height="1.5" rx="0.5" fill={lit ? '#FFD060' : '#999'} opacity="0.8"/>
		<!-- Glow halo around lens -->
		<rect data-lamp-glow x="24" y="0" width="16" height="5" rx="2" fill="var(--accent)" opacity={lit ? 0.15 : 0}/>
	</svg>
<style>svg { display: block; width: 100%; height: auto; pointer-events: none; }</style>
