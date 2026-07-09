<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 1000 250"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<!-- Title block -->
	<text x="15" y="18" font-family="JetBrains Mono" font-size="10" fill="currentColor"
		>ÉLÉVATION · PONT-RAIL TYPE PR-4</text
	>
	<line x1="15" y1="22" x2="310" y2="22" stroke="currentColor" stroke-width="0.5" />

	<!-- Border frame -->
	<rect
		x="5"
		y="28"
		width="990"
		height="215"
		rx="4"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="4 2"
	/>

	<!-- Ground / foundation line -->
	<line x1="40" y1="200" x2="960" y2="200" stroke="currentColor" stroke-width="1.5" />
	<line x1="40" y1="203" x2="960" y2="203" stroke="currentColor" stroke-width="0.5" />

	<!-- Foundation hatching -->
	<path
		d="M40 203 l-6 8 M60 203 l-6 8 M80 203 l-6 8 M100 203 l-6 8 M120 203 l-6 8 M140 203 l-6 8 M160 203 l-6 8 M180 203 l-6 8 M200 203 l-6 8 M220 203 l-6 8 M240 203 l-6 8 M260 203 l-6 8 M280 203 l-6 8 M300 203 l-6 8 M320 203 l-6 8 M340 203 l-6 8 M360 203 l-6 8 M380 203 l-6 8 M400 203 l-6 8 M420 203 l-6 8 M440 203 l-6 8 M460 203 l-6 8 M480 203 l-6 8 M500 203 l-6 8 M520 203 l-6 8 M540 203 l-6 8 M560 203 l-6 8 M580 203 l-6 8 M600 203 l-6 8 M620 203 l-6 8 M640 203 l-6 8 M660 203 l-6 8 M680 203 l-6 8 M700 203 l-6 8 M720 203 l-6 8 M740 203 l-6 8 M760 203 l-6 8 M780 203 l-6 8 M800 203 l-6 8 M820 203 l-6 8 M840 203 l-6 8 M860 203 l-6 8 M880 203 l-6 8 M900 203 l-6 8 M920 203 l-6 8 M940 203 l-6 8 M960 203 l-6 8"
		stroke="currentColor"
		stroke-width="0.3"
	/>

	<!-- Deck line (double) -->
	<line x1="40" y1="68" x2="960" y2="68" stroke="currentColor" stroke-width="1.5" />
	<line x1="40" y1="74" x2="960" y2="74" stroke="currentColor" stroke-width="1" />

	<!-- Rail lines on deck (dashed) -->
	<line
		x1="40"
		y1="64"
		x2="960"
		y2="64"
		stroke="currentColor"
		stroke-width="0.5"
		stroke-dasharray="8 4"
	/>
	<line
		x1="40"
		y1="60"
		x2="960"
		y2="60"
		stroke="currentColor"
		stroke-width="0.5"
		stroke-dasharray="8 4"
	/>

	<!-- Arch span 1 (left) -->
	<path d="M100 200 Q 295 85 490 200" stroke="currentColor" stroke-width="1.5" fill="none" />
	<path d="M108 200 Q 295 92 482 200" stroke="currentColor" stroke-width="0.75" fill="none" />

	<!-- Arch span 2 (right) -->
	<path d="M510 200 Q 705 85 900 200" stroke="currentColor" stroke-width="1.5" fill="none" />
	<path d="M518 200 Q 705 92 892 200" stroke="currentColor" stroke-width="0.75" fill="none" />

	<!-- 7 Vertical supports -->
	<!-- Support 1 — left abutment -->
	<line x1="80" y1="74" x2="80" y2="200" stroke="currentColor" stroke-width="1.5" />
	<rect
		x="72"
		y="192"
		width="16"
		height="8"
		stroke="currentColor"
		stroke-width="0.75"
		fill="none"
	/>

	<!-- Support 2 -->
	<line x1="200" y1="74" x2="200" y2="160" stroke="currentColor" stroke-width="1.2" />
	<rect
		x="194"
		y="155"
		width="12"
		height="6"
		stroke="currentColor"
		stroke-width="0.5"
		fill="none"
	/>

	<!-- Support 3 -->
	<line x1="350" y1="74" x2="350" y2="120" stroke="currentColor" stroke-width="1.2" />
	<rect
		x="344"
		y="115"
		width="12"
		height="6"
		stroke="currentColor"
		stroke-width="0.5"
		fill="none"
	/>

	<!-- Support 4 — center pier -->
	<line x1="500" y1="74" x2="500" y2="200" stroke="currentColor" stroke-width="2" />
	<rect
		x="490"
		y="192"
		width="20"
		height="8"
		stroke="currentColor"
		stroke-width="0.75"
		fill="none"
	/>
	<rect
		x="492"
		y="74"
		width="16"
		height="10"
		stroke="currentColor"
		stroke-width="0.5"
		fill="none"
	/>

	<!-- Support 5 -->
	<line x1="650" y1="74" x2="650" y2="120" stroke="currentColor" stroke-width="1.2" />
	<rect
		x="644"
		y="115"
		width="12"
		height="6"
		stroke="currentColor"
		stroke-width="0.5"
		fill="none"
	/>

	<!-- Support 6 -->
	<line x1="800" y1="74" x2="800" y2="160" stroke="currentColor" stroke-width="1.2" />
	<rect
		x="794"
		y="155"
		width="12"
		height="6"
		stroke="currentColor"
		stroke-width="0.5"
		fill="none"
	/>

	<!-- Support 7 — right abutment -->
	<line x1="920" y1="74" x2="920" y2="200" stroke="currentColor" stroke-width="1.5" />
	<rect
		x="912"
		y="192"
		width="16"
		height="8"
		stroke="currentColor"
		stroke-width="0.75"
		fill="none"
	/>

	<!-- Cross-bracing between supports (left span) -->
	<line x1="80" y1="80" x2="200" y2="155" stroke="currentColor" stroke-width="0.5" />
	<line x1="80" y1="155" x2="200" y2="80" stroke="currentColor" stroke-width="0.5" />
	<line x1="200" y1="80" x2="350" y2="115" stroke="currentColor" stroke-width="0.5" />
	<line x1="200" y1="115" x2="350" y2="80" stroke="currentColor" stroke-width="0.5" />
	<line x1="350" y1="80" x2="500" y2="155" stroke="currentColor" stroke-width="0.5" />
	<line x1="350" y1="115" x2="500" y2="80" stroke="currentColor" stroke-width="0.5" />

	<!-- Cross-bracing between supports (right span) -->
	<line x1="500" y1="80" x2="650" y2="115" stroke="currentColor" stroke-width="0.5" />
	<line x1="500" y1="115" x2="650" y2="80" stroke="currentColor" stroke-width="0.5" />
	<line x1="650" y1="80" x2="800" y2="155" stroke="currentColor" stroke-width="0.5" />
	<line x1="650" y1="115" x2="800" y2="80" stroke="currentColor" stroke-width="0.5" />
	<line x1="800" y1="80" x2="920" y2="155" stroke="currentColor" stroke-width="0.5" />
	<line x1="800" y1="155" x2="920" y2="80" stroke="currentColor" stroke-width="0.5" />

	<!-- Horizontal bracing members -->
	<line
		x1="80"
		y1="110"
		x2="500"
		y2="110"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="3 3"
	/>
	<line
		x1="500"
		y1="110"
		x2="920"
		y2="110"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="3 3"
	/>
	<line
		x1="80"
		y1="140"
		x2="500"
		y2="140"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="3 3"
	/>
	<line
		x1="500"
		y1="140"
		x2="920"
		y2="140"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="3 3"
	/>

	<!-- Reference marks at arch peaks -->
	<!-- Arch 1 peak -->
	<circle cx="295" cy="88" r="6" stroke="currentColor" stroke-width="0.75" fill="none" />
	<circle cx="295" cy="88" r="2" fill="currentColor" />
	<line x1="295" y1="82" x2="295" y2="75" stroke="currentColor" stroke-width="0.5" />
	<line x1="295" y1="94" x2="295" y2="100" stroke="currentColor" stroke-width="0.5" />
	<text
		x="295"
		y="48"
		font-family="JetBrains Mono"
		font-size="7"
		fill="currentColor"
		text-anchor="middle">SPT-A1</text
	>
	<line
		x1="295"
		y1="50"
		x2="295"
		y2="75"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="2 2"
	/>

	<!-- Arch 2 peak -->
	<circle cx="705" cy="88" r="6" stroke="currentColor" stroke-width="0.75" fill="none" />
	<circle cx="705" cy="88" r="2" fill="currentColor" />
	<line x1="705" y1="82" x2="705" y2="75" stroke="currentColor" stroke-width="0.5" />
	<line x1="705" y1="94" x2="705" y2="100" stroke="currentColor" stroke-width="0.5" />
	<text
		x="705"
		y="48"
		font-family="JetBrains Mono"
		font-size="7"
		fill="currentColor"
		text-anchor="middle">SPT-A2</text
	>
	<line
		x1="705"
		y1="50"
		x2="705"
		y2="75"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="2 2"
	/>

	<!-- Dimension lines at bottom -->
	<!-- Left span dimension -->
	<line x1="100" y1="220" x2="490" y2="220" stroke="currentColor" stroke-width="0.5" />
	<line x1="100" y1="216" x2="100" y2="224" stroke="currentColor" stroke-width="0.5" />
	<line x1="490" y1="216" x2="490" y2="224" stroke="currentColor" stroke-width="0.5" />
	<text
		x="295"
		y="228"
		font-family="JetBrains Mono"
		font-size="7"
		fill="currentColor"
		text-anchor="middle">460.0 m</text
	>

	<!-- Right span dimension -->
	<line x1="510" y1="220" x2="900" y2="220" stroke="currentColor" stroke-width="0.5" />
	<line x1="510" y1="216" x2="510" y2="224" stroke="currentColor" stroke-width="0.5" />
	<line x1="900" y1="216" x2="900" y2="224" stroke="currentColor" stroke-width="0.5" />
	<text
		x="705"
		y="228"
		font-family="JetBrains Mono"
		font-size="7"
		fill="currentColor"
		text-anchor="middle">460.0 m</text
	>

	<!-- Overall dimension -->
	<line x1="80" y1="235" x2="920" y2="235" stroke="currentColor" stroke-width="0.5" />
	<line x1="80" y1="231" x2="80" y2="239" stroke="currentColor" stroke-width="0.5" />
	<line x1="920" y1="231" x2="920" y2="239" stroke="currentColor" stroke-width="0.5" />
	<text
		x="500"
		y="243"
		font-family="JetBrains Mono"
		font-size="7"
		fill="currentColor"
		text-anchor="middle">960.0 m · LONGUEUR TOTALE</text
	>

	<!-- Deck detail — expansion joints -->
	<line x1="495" y1="64" x2="505" y2="64" stroke="currentColor" stroke-width="0.75" />
	<line x1="495" y1="68" x2="505" y2="68" stroke="currentColor" stroke-width="0.75" />
	<path d="M497 60 v18 M503 60 v18" stroke="currentColor" stroke-width="0.3" />

	<!-- Parapet lines -->
	<line x1="40" y1="56" x2="960" y2="56" stroke="currentColor" stroke-width="0.5" />
	<line x1="40" y1="56" x2="40" y2="68" stroke="currentColor" stroke-width="0.5" />
	<line x1="960" y1="56" x2="960" y2="68" stroke="currentColor" stroke-width="0.5" />

	<!-- Abutment wing walls -->
	<path d="M40 200 L30 200 L25 210" stroke="currentColor" stroke-width="1" />
	<path d="M960 200 L970 200 L975 210" stroke="currentColor" stroke-width="1" />

	<!-- Section reference indicators -->
	<text x="50" y="42" font-family="JetBrains Mono" font-size="6" fill="currentColor">A</text>
	<circle cx="50" cy="44" r="7" stroke="currentColor" stroke-width="0.5" fill="none" />
	<line x1="50" y1="51" x2="50" y2="56" stroke="currentColor" stroke-width="0.3" />

	<text
		x="950"
		y="42"
		font-family="JetBrains Mono"
		font-size="6"
		fill="currentColor"
		text-anchor="middle">A</text
	>
	<circle cx="950" cy="44" r="7" stroke="currentColor" stroke-width="0.5" fill="none" />
	<line x1="950" y1="51" x2="950" y2="56" stroke="currentColor" stroke-width="0.3" />

	<!-- Scale reference -->
	<text
		x="900"
		y="18"
		font-family="JetBrains Mono"
		font-size="6"
		fill="currentColor"
		text-anchor="end">ÉCH. 1:500</text
	>

	<!-- Drawing number -->
	<text
		x="960"
		y="18"
		font-family="JetBrains Mono"
		font-size="6"
		fill="currentColor"
		text-anchor="end">DWG PR-4-001</text
	>
</svg>
