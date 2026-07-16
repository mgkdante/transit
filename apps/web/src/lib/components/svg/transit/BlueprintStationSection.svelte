<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 300 170"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<!-- Title block -->
	<text x="8" y="13" font-family="JetBrains Mono" font-size="7" fill="currentColor"
		>SECTION TYPE ST-3 · STATION</text
	>
	<line x1="8" y1="16" x2="195" y2="16" stroke="currentColor" stroke-width="0.5" />

	<!-- Border frame -->
	<rect
		x="3"
		y="19"
		width="294"
		height="148"
		rx="4"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="4 2"
	/>

	<!-- Tunnel arch (outer) -->
	<path
		d="M40 140 L40 65 Q40 28 80 28 L220 28 Q260 28 260 65 L260 140"
		stroke="currentColor"
		stroke-width="1.5"
		fill="none"
	/>

	<!-- Tunnel arch (inner detail / lining) -->
	<path
		d="M46 140 L46 68 Q46 34 83 34 L217 34 Q254 34 254 68 L254 140"
		stroke="currentColor"
		stroke-width="0.5"
		stroke-dasharray="4 2"
		fill="none"
	/>

	<!-- Ceiling detail — inner arch (dashed) -->
	<path
		d="M55 70 Q55 42 90 42 L210 42 Q245 42 245 70"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="3 2"
		fill="none"
	/>

	<!-- Ceiling equipment (conduits) -->
	<line
		x1="70"
		y1="48"
		x2="230"
		y2="48"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="2 3"
	/>
	<line
		x1="75"
		y1="52"
		x2="225"
		y2="52"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="2 3"
	/>

	<!-- Ventilation duct outline -->
	<rect
		x="130"
		y="38"
		width="40"
		height="8"
		rx="2"
		stroke="currentColor"
		stroke-width="0.4"
		fill="none"
	/>
	<text
		x="150"
		y="44"
		font-family="JetBrains Mono"
		font-size="3"
		fill="currentColor"
		text-anchor="middle">VENT</text
	>

	<!-- Platform A (left) -->
	<rect x="48" y="112" width="58" height="10" stroke="currentColor" stroke-width="1" fill="none" />
	<!-- Platform surface detail -->
	<line x1="48" y1="112" x2="106" y2="112" stroke="currentColor" stroke-width="1.2" />
	<!-- Platform hatching -->
	<path
		d="M52 112 v10 M58 112 v10 M64 112 v10 M70 112 v10 M76 112 v10 M82 112 v10 M88 112 v10 M94 112 v10 M100 112 v10"
		stroke="currentColor"
		stroke-width="0.2"
	/>
	<!-- Platform edge (safety strip) -->
	<line x1="104" y1="112" x2="104" y2="122" stroke="currentColor" stroke-width="0.75" />
	<!-- Label -->
	<text
		x="77"
		y="108"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="middle">QUAI A</text
	>

	<!-- Platform B (right) -->
	<rect x="194" y="112" width="58" height="10" stroke="currentColor" stroke-width="1" fill="none" />
	<!-- Platform surface detail -->
	<line x1="194" y1="112" x2="252" y2="112" stroke="currentColor" stroke-width="1.2" />
	<!-- Platform hatching -->
	<path
		d="M198 112 v10 M204 112 v10 M210 112 v10 M216 112 v10 M222 112 v10 M228 112 v10 M234 112 v10 M240 112 v10 M246 112 v10"
		stroke="currentColor"
		stroke-width="0.2"
	/>
	<!-- Platform edge (safety strip) -->
	<line x1="196" y1="112" x2="196" y2="122" stroke="currentColor" stroke-width="0.75" />
	<!-- Label -->
	<text
		x="223"
		y="108"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="middle">QUAI B</text
	>

	<!-- Track gap between platforms — two rails -->
	<line x1="110" y1="120" x2="190" y2="120" stroke="currentColor" stroke-width="1" />
	<line x1="110" y1="124" x2="190" y2="124" stroke="currentColor" stroke-width="1" />

	<!-- Center rail (dashed) -->
	<line
		x1="110"
		y1="122"
		x2="190"
		y2="122"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="4 2"
	/>

	<!-- Sleepers / ties in track gap -->
	<line x1="120" y1="118" x2="120" y2="126" stroke="currentColor" stroke-width="0.5" />
	<line x1="132" y1="118" x2="132" y2="126" stroke="currentColor" stroke-width="0.5" />
	<line x1="144" y1="118" x2="144" y2="126" stroke="currentColor" stroke-width="0.5" />
	<line x1="156" y1="118" x2="156" y2="126" stroke="currentColor" stroke-width="0.5" />
	<line x1="168" y1="118" x2="168" y2="126" stroke="currentColor" stroke-width="0.5" />
	<line x1="180" y1="118" x2="180" y2="126" stroke="currentColor" stroke-width="0.5" />

	<!-- Ballast area under rails -->
	<path
		d="M108 126 L108 134 L192 134 L192 126"
		stroke="currentColor"
		stroke-width="0.5"
		fill="none"
	/>
	<!-- Ballast hatching -->
	<path
		d="M112 128 l4 4 M120 128 l4 4 M128 128 l4 4 M136 128 l4 4 M144 128 l4 4 M152 128 l4 4 M160 128 l4 4 M168 128 l4 4 M176 128 l4 4 M184 128 l4 4"
		stroke="currentColor"
		stroke-width="0.2"
	/>

	<!-- Invert curve at bottom -->
	<path d="M40 140 Q150 150 260 140" stroke="currentColor" stroke-width="1" fill="none" />
	<!-- Invert inner line -->
	<path
		d="M46 139 Q150 147 254 139"
		stroke="currentColor"
		stroke-width="0.4"
		stroke-dasharray="3 2"
		fill="none"
	/>

	<!-- Floor / slab line -->
	<line x1="48" y1="134" x2="106" y2="134" stroke="currentColor" stroke-width="0.75" />
	<line x1="194" y1="134" x2="252" y2="134" stroke="currentColor" stroke-width="0.75" />

	<!-- Drain at invert center -->
	<circle cx="150" cy="144" r="3" stroke="currentColor" stroke-width="0.5" fill="none" />
	<circle cx="150" cy="144" r="1" fill="currentColor" />
	<text
		x="150"
		y="152"
		font-family="JetBrains Mono"
		font-size="3"
		fill="currentColor"
		text-anchor="middle">DRAIN</text
	>

	<!-- Column / pillar supports -->
	<rect x="108" y="65" width="4" height="47" stroke="currentColor" stroke-width="0.5" fill="none" />
	<rect x="188" y="65" width="4" height="47" stroke="currentColor" stroke-width="0.5" fill="none" />

	<!-- Column capitals -->
	<rect x="106" y="62" width="8" height="4" stroke="currentColor" stroke-width="0.4" fill="none" />
	<rect x="186" y="62" width="8" height="4" stroke="currentColor" stroke-width="0.4" fill="none" />

	<!-- Lighting fixtures -->
	<circle cx="85" cy="60" r="2" stroke="currentColor" stroke-width="0.4" fill="none" />
	<line x1="85" y1="56" x2="85" y2="58" stroke="currentColor" stroke-width="0.3" />
	<circle cx="150" cy="56" r="2" stroke="currentColor" stroke-width="0.4" fill="none" />
	<line x1="150" y1="52" x2="150" y2="54" stroke="currentColor" stroke-width="0.3" />
	<circle cx="215" cy="60" r="2" stroke="currentColor" stroke-width="0.4" fill="none" />
	<line x1="215" y1="56" x2="215" y2="58" stroke="currentColor" stroke-width="0.3" />

	<!-- Width dimension (bottom) -->
	<line x1="40" y1="158" x2="260" y2="158" stroke="currentColor" stroke-width="0.3" />
	<line x1="40" y1="155" x2="40" y2="161" stroke="currentColor" stroke-width="0.3" />
	<line x1="260" y1="155" x2="260" y2="161" stroke="currentColor" stroke-width="0.3" />
	<text
		x="150"
		y="164"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="middle">18,4 m · LARGEUR TOTALE</text
	>

	<!-- Height dimension (right side) -->
	<line x1="272" y1="28" x2="272" y2="140" stroke="currentColor" stroke-width="0.3" />
	<line x1="269" y1="28" x2="275" y2="28" stroke="currentColor" stroke-width="0.3" />
	<line x1="269" y1="140" x2="275" y2="140" stroke="currentColor" stroke-width="0.3" />
	<text
		x="266"
		y="90"
		font-family="JetBrains Mono"
		font-size="4"
		fill="currentColor"
		text-anchor="end">H = 9,2 m</text
	>

	<!-- Platform height dimension (left) -->
	<line x1="30" y1="112" x2="30" y2="140" stroke="currentColor" stroke-width="0.3" />
	<line x1="27" y1="112" x2="33" y2="112" stroke="currentColor" stroke-width="0.3" />
	<line x1="27" y1="140" x2="33" y2="140" stroke="currentColor" stroke-width="0.3" />
	<text
		x="34"
		y="128"
		font-family="JetBrains Mono"
		font-size="3.5"
		fill="currentColor"
		text-anchor="start">1,2 m</text
	>

	<!-- Section markers -->
	<text
		x="22"
		y="90"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="middle">B</text
	>
	<circle cx="22" cy="92" r="6" stroke="currentColor" stroke-width="0.4" fill="none" />

	<text
		x="280"
		y="90"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="middle">B</text
	>
	<circle cx="280" cy="92" r="6" stroke="currentColor" stroke-width="0.4" fill="none" />

	<!-- Drawing info -->
	<text
		x="290"
		y="13"
		font-family="JetBrains Mono"
		font-size="4"
		fill="currentColor"
		text-anchor="end">DWG ST-3-005</text
	>

	<!-- Scale reference -->
	<text
		x="245"
		y="13"
		font-family="JetBrains Mono"
		font-size="4"
		fill="currentColor"
		text-anchor="end">ÉCH. 1:50</text
	>

	<!-- Track label -->
	<text
		x="150"
		y="116"
		font-family="JetBrains Mono"
		font-size="4"
		fill="currentColor"
		text-anchor="middle">VOIE 1</text
	>
</svg>
