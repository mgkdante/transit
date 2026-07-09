<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 600 200"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<!-- Title block -->
	<text x="10" y="16" font-family="JetBrains Mono" font-size="9" fill="currentColor"
		>PLAN DE VOIE · AIGUILLAGE SW-14</text
	>
	<line x1="10" y1="20" x2="285" y2="20" stroke="currentColor" stroke-width="0.5" />

	<!-- Border frame -->
	<rect
		x="3"
		y="25"
		width="594"
		height="170"
		rx="4"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="4 2"
	/>

	<!-- Main double track (VOIE A) — straight through -->
	<line x1="20" y1="90" x2="580" y2="90" stroke="currentColor" stroke-width="1.2" />
	<line x1="20" y1="100" x2="580" y2="100" stroke="currentColor" stroke-width="1.2" />

	<!-- Center rail dashed -->
	<line
		x1="20"
		y1="95"
		x2="580"
		y2="95"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="6 4"
	/>

	<!-- Sleeper / tie marks on main track (11 marks) -->
	<line x1="50" y1="87" x2="50" y2="103" stroke="currentColor" stroke-width="0.75" />
	<line x1="90" y1="87" x2="90" y2="103" stroke="currentColor" stroke-width="0.75" />
	<line x1="130" y1="87" x2="130" y2="103" stroke="currentColor" stroke-width="0.75" />
	<line x1="170" y1="87" x2="170" y2="103" stroke="currentColor" stroke-width="0.75" />
	<line x1="210" y1="87" x2="210" y2="103" stroke="currentColor" stroke-width="0.75" />
	<line x1="250" y1="87" x2="250" y2="103" stroke="currentColor" stroke-width="0.75" />
	<line x1="370" y1="87" x2="370" y2="103" stroke="currentColor" stroke-width="0.75" />
	<line x1="410" y1="87" x2="410" y2="103" stroke="currentColor" stroke-width="0.75" />
	<line x1="450" y1="87" x2="450" y2="103" stroke="currentColor" stroke-width="0.75" />
	<line x1="490" y1="87" x2="490" y2="103" stroke="currentColor" stroke-width="0.75" />
	<line x1="530" y1="87" x2="530" y2="103" stroke="currentColor" stroke-width="0.75" />

	<!-- Turnout / diverging track (VOIE B) -->
	<!-- Switch point origin at x=280 -->
	<path d="M280 100 Q 350 120 420 140" stroke="currentColor" stroke-width="1.2" fill="none" />
	<path d="M280 100 Q 355 125 425 145" stroke="currentColor" stroke-width="1.2" fill="none" />

	<!-- Diverging track continues -->
	<line x1="420" y1="140" x2="580" y2="140" stroke="currentColor" stroke-width="1.2" />
	<line x1="425" y1="145" x2="580" y2="145" stroke="currentColor" stroke-width="1.2" />

	<!-- Center rail diverging (dashed) -->
	<path
		d="M290 102 Q 355 122 425 142.5"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="4 3"
		fill="none"
	/>
	<line
		x1="425"
		y1="142.5"
		x2="580"
		y2="142.5"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="4 3"
	/>

	<!-- Sleepers on diverging track -->
	<line x1="440" y1="137" x2="440" y2="148" stroke="currentColor" stroke-width="0.75" />
	<line x1="470" y1="137" x2="470" y2="148" stroke="currentColor" stroke-width="0.75" />
	<line x1="500" y1="137" x2="500" y2="148" stroke="currentColor" stroke-width="0.75" />
	<line x1="530" y1="137" x2="530" y2="148" stroke="currentColor" stroke-width="0.75" />
	<line x1="560" y1="137" x2="560" y2="148" stroke="currentColor" stroke-width="0.75" />

	<!-- Switch mechanism -->
	<circle cx="280" cy="95" r="8" stroke="currentColor" stroke-width="1" fill="none" />
	<circle cx="280" cy="95" r="3" fill="currentColor" />
	<line x1="280" y1="103" x2="280" y2="115" stroke="currentColor" stroke-width="0.75" />
	<line x1="275" y1="115" x2="285" y2="115" stroke="currentColor" stroke-width="0.75" />

	<!-- Switch point blades -->
	<line x1="280" y1="90" x2="310" y2="90" stroke="currentColor" stroke-width="0.5" />
	<line x1="280" y1="100" x2="310" y2="105" stroke="currentColor" stroke-width="0.5" />

	<!-- Frog / crossing point -->
	<path d="M310 88 l8 4 l-8 4" stroke="currentColor" stroke-width="0.5" fill="none" />

	<!-- Switch label -->
	<text
		x="280"
		y="130"
		font-family="JetBrains Mono"
		font-size="8"
		fill="currentColor"
		text-anchor="middle">SW-14</text
	>

	<!-- Route labels -->
	<text
		x="140"
		y="85"
		font-family="JetBrains Mono"
		font-size="8"
		fill="currentColor"
		text-anchor="middle">VOIE A</text
	>
	<text
		x="520"
		y="160"
		font-family="JetBrains Mono"
		font-size="8"
		fill="currentColor"
		text-anchor="middle">VOIE B</text
	>

	<!-- Platform outline (dashed rectangle) -->
	<rect
		x="380"
		y="42"
		width="180"
		height="35"
		rx="3"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="6 3"
	/>
	<text
		x="470"
		y="63"
		font-family="JetBrains Mono"
		font-size="7"
		fill="currentColor"
		text-anchor="middle">QUAI / PLATFORM</text
	>

	<!-- Platform edge detail -->
	<line x1="380" y1="77" x2="560" y2="77" stroke="currentColor" stroke-width="0.5" />
	<line
		x1="380"
		y1="80"
		x2="560"
		y2="80"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="2 2"
	/>

	<!-- Platform hatching -->
	<path
		d="M390 42 l0 35 M410 42 l0 35 M430 42 l0 35 M450 42 l0 35 M470 42 l0 35 M490 42 l0 35 M510 42 l0 35 M530 42 l0 35 M550 42 l0 35"
		stroke="currentColor"
		stroke-width="0.2"
	/>

	<!-- Signal indicators -->
	<rect x="260" y="75" width="4" height="8" stroke="currentColor" stroke-width="0.5" fill="none" />
	<circle cx="262" cy="73" r="2" stroke="currentColor" stroke-width="0.5" fill="none" />
	<text
		x="262"
		y="68"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="middle">S14</text
	>

	<!-- Track chainage marks -->
	<line x1="100" y1="103" x2="100" y2="110" stroke="currentColor" stroke-width="0.3" />
	<text
		x="100"
		y="117"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="middle">KM 2+100</text
	>

	<line x1="400" y1="103" x2="400" y2="110" stroke="currentColor" stroke-width="0.3" />
	<text
		x="400"
		y="117"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="middle">KM 2+400</text
	>

	<!-- North arrow -->
	<line x1="40" y1="50" x2="40" y2="35" stroke="currentColor" stroke-width="0.75" />
	<path d="M36 39 L40 32 L44 39" stroke="currentColor" stroke-width="0.75" fill="none" />
	<text
		x="40"
		y="57"
		font-family="JetBrains Mono"
		font-size="6"
		fill="currentColor"
		text-anchor="middle">N</text
	>

	<!-- Track gauge dimension -->
	<line x1="22" y1="90" x2="22" y2="100" stroke="currentColor" stroke-width="0.3" />
	<line x1="18" y1="90" x2="26" y2="90" stroke="currentColor" stroke-width="0.3" />
	<line x1="18" y1="100" x2="26" y2="100" stroke="currentColor" stroke-width="0.3" />
	<text
		x="15"
		y="97"
		font-family="JetBrains Mono"
		font-size="4"
		fill="currentColor"
		text-anchor="end"
		transform="rotate(-90 15 97)">1435</text
	>

	<!-- Turnout angle notation -->
	<path d="M320 100 A 40 40 0 0 1 325 108" stroke="currentColor" stroke-width="0.3" fill="none" />
	<text x="336" y="110" font-family="JetBrains Mono" font-size="5" fill="currentColor">1:14</text>

	<!-- Drawing info -->
	<text
		x="540"
		y="16"
		font-family="JetBrains Mono"
		font-size="6"
		fill="currentColor"
		text-anchor="end">ÉCH. 1:200</text
	>
	<text
		x="590"
		y="16"
		font-family="JetBrains Mono"
		font-size="6"
		fill="currentColor"
		text-anchor="end">DWG VP-14-002</text
	>

	<!-- Ballast edge lines -->
	<line
		x1="20"
		y1="85"
		x2="580"
		y2="85"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="2 4"
	/>
	<line
		x1="20"
		y1="105"
		x2="260"
		y2="105"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="2 4"
	/>
	<line
		x1="340"
		y1="108"
		x2="400"
		y2="135"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="2 4"
	/>
	<line
		x1="400"
		y1="135"
		x2="580"
		y2="135"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="2 4"
	/>
	<line
		x1="420"
		y1="150"
		x2="580"
		y2="150"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="2 4"
	/>
	<line
		x1="310"
		y1="105"
		x2="580"
		y2="105"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="2 4"
	/>
</svg>
