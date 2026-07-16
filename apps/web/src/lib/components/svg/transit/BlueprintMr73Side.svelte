<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 1800 700"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	preserveAspectRatio="xMidYMid meet"
>
	<line x1="20" y1="540" x2="1780" y2="540" stroke="currentColor" stroke-width="2" />
	<line x1="20" y1="545" x2="1780" y2="545" stroke="currentColor" stroke-width="0.5" />
	<g stroke="currentColor" stroke-width="1" opacity="0.5">
		<line x1="60" y1="540" x2="60" y2="555" /><line x1="120" y1="540" x2="120" y2="555" /><line
			x1="180"
			y1="540"
			x2="180"
			y2="555"
		/><line x1="240" y1="540" x2="240" y2="555" /><line x1="300" y1="540" x2="300" y2="555" /><line
			x1="360"
			y1="540"
			x2="360"
			y2="555"
		/><line x1="420" y1="540" x2="420" y2="555" /><line x1="480" y1="540" x2="480" y2="555" /><line
			x1="540"
			y1="540"
			x2="540"
			y2="555"
		/><line x1="600" y1="540" x2="600" y2="555" /><line x1="660" y1="540" x2="660" y2="555" /><line
			x1="720"
			y1="540"
			x2="720"
			y2="555"
		/><line x1="780" y1="540" x2="780" y2="555" /><line x1="840" y1="540" x2="840" y2="555" /><line
			x1="900"
			y1="540"
			x2="900"
			y2="555"
		/><line x1="960" y1="540" x2="960" y2="555" /><line
			x1="1020"
			y1="540"
			x2="1020"
			y2="555"
		/><line x1="1080" y1="540" x2="1080" y2="555" /><line
			x1="1140"
			y1="540"
			x2="1140"
			y2="555"
		/><line x1="1200" y1="540" x2="1200" y2="555" /><line
			x1="1260"
			y1="540"
			x2="1260"
			y2="555"
		/><line x1="1320" y1="540" x2="1320" y2="555" /><line
			x1="1380"
			y1="540"
			x2="1380"
			y2="555"
		/><line x1="1440" y1="540" x2="1440" y2="555" /><line
			x1="1500"
			y1="540"
			x2="1500"
			y2="555"
		/><line x1="1560" y1="540" x2="1560" y2="555" /><line
			x1="1620"
			y1="540"
			x2="1620"
			y2="555"
		/><line x1="1680" y1="540" x2="1680" y2="555" /><line x1="1740" y1="540" x2="1740" y2="555" />
	</g>
	<rect x="140" y="210" width="1520" height="280" rx="24" stroke="currentColor" stroke-width="2" />
	<path
		d="M164 210 Q900 160 1636 210"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-dasharray="10 5"
	/>
	<rect
		x="600"
		y="175"
		width="400"
		height="35"
		rx="8"
		stroke="currentColor"
		stroke-width="1"
		stroke-dasharray="6 3"
	/>
	<line x1="720" y1="175" x2="720" y2="155" stroke="currentColor" stroke-width="1.5" />
	<line x1="880" y1="175" x2="880" y2="155" stroke="currentColor" stroke-width="1.5" />
	<line x1="700" y1="155" x2="900" y2="155" stroke="currentColor" stroke-width="1.5" />
	<path d="M770 155 v-20 h60 v20" stroke="currentColor" stroke-width="2" />
	<rect x="778" y="128" width="44" height="8" rx="2" stroke="currentColor" stroke-width="1" />
	<line x1="140" y1="490" x2="1660" y2="490" stroke="currentColor" stroke-width="1.5" />
	<!-- Doors -->
	<rect
		x="260"
		y="240"
		width="22"
		height="240"
		rx="4"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-dasharray="5 2"
	/><rect
		x="286"
		y="240"
		width="22"
		height="240"
		rx="4"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-dasharray="5 2"
	/>
	<rect
		x="620"
		y="240"
		width="22"
		height="240"
		rx="4"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-dasharray="5 2"
	/><rect
		x="646"
		y="240"
		width="22"
		height="240"
		rx="4"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-dasharray="5 2"
	/>
	<rect
		x="932"
		y="240"
		width="22"
		height="240"
		rx="4"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-dasharray="5 2"
	/><rect
		x="958"
		y="240"
		width="22"
		height="240"
		rx="4"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-dasharray="5 2"
	/>
	<rect
		x="1292"
		y="240"
		width="22"
		height="240"
		rx="4"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-dasharray="5 2"
	/><rect
		x="1318"
		y="240"
		width="22"
		height="240"
		rx="4"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-dasharray="5 2"
	/>
	<!-- Windows -->
	<rect x="170" y="260" width="70" height="80" rx="8" stroke="currentColor" stroke-width="1.5" />
	<rect
		x="330"
		y="260"
		width="110"
		height="80"
		rx="8"
		stroke="currentColor"
		stroke-width="1.5"
	/><rect x="465" y="260" width="110" height="80" rx="8" stroke="currentColor" stroke-width="1.5" />
	<rect
		x="695"
		y="260"
		width="90"
		height="80"
		rx="8"
		stroke="currentColor"
		stroke-width="1.5"
	/><rect x="810" y="260" width="90" height="80" rx="8" stroke="currentColor" stroke-width="1.5" />
	<rect
		x="1005"
		y="260"
		width="110"
		height="80"
		rx="8"
		stroke="currentColor"
		stroke-width="1.5"
	/><rect
		x="1140"
		y="260"
		width="110"
		height="80"
		rx="8"
		stroke="currentColor"
		stroke-width="1.5"
	/>
	<rect
		x="1365"
		y="260"
		width="110"
		height="80"
		rx="8"
		stroke="currentColor"
		stroke-width="1.5"
	/><rect x="1510" y="260" width="70" height="80" rx="8" stroke="currentColor" stroke-width="1.5" />
	<!-- Couplers -->
	<path d="M140 350 h-40 v30 h40" stroke="currentColor" stroke-width="2" /><circle
		cx="85"
		cy="365"
		r="8"
		stroke="currentColor"
		stroke-width="1.5"
	/>
	<path d="M1660 350 h40 v30 h-40" stroke="currentColor" stroke-width="2" /><circle
		cx="1715"
		cy="365"
		r="8"
		stroke="currentColor"
		stroke-width="1.5"
	/>
	<!-- Bogies -->
	<rect x="220" y="498" width="180" height="36" rx="8" stroke="currentColor" stroke-width="1.5" />
	<rect x="1400" y="498" width="180" height="36" rx="8" stroke="currentColor" stroke-width="1.5" />
	<!-- Wheels -->
	<circle cx="265" cy="540" r="22" stroke="currentColor" stroke-width="2" /><circle
		cx="265"
		cy="540"
		r="8"
		stroke="currentColor"
		stroke-width="1"
	/><circle cx="265" cy="540" r="3" fill="currentColor" />
	<circle cx="355" cy="540" r="22" stroke="currentColor" stroke-width="2" /><circle
		cx="355"
		cy="540"
		r="8"
		stroke="currentColor"
		stroke-width="1"
	/><circle cx="355" cy="540" r="3" fill="currentColor" />
	<line x1="265" y1="540" x2="355" y2="540" stroke="currentColor" stroke-width="1.5" />
	<circle cx="1445" cy="540" r="22" stroke="currentColor" stroke-width="2" /><circle
		cx="1445"
		cy="540"
		r="8"
		stroke="currentColor"
		stroke-width="1"
	/><circle cx="1445" cy="540" r="3" fill="currentColor" />
	<circle cx="1535" cy="540" r="22" stroke="currentColor" stroke-width="2" /><circle
		cx="1535"
		cy="540"
		r="8"
		stroke="currentColor"
		stroke-width="1"
	/><circle cx="1535" cy="540" r="3" fill="currentColor" />
	<line x1="1445" y1="540" x2="1535" y2="540" stroke="currentColor" stroke-width="1.5" />
	<!-- Guide wheels -->
	<circle cx="235" cy="520" r="10" stroke="currentColor" stroke-width="1" /><circle
		cx="385"
		cy="520"
		r="10"
		stroke="currentColor"
		stroke-width="1"
	/>
	<circle cx="1415" cy="520" r="10" stroke="currentColor" stroke-width="1" /><circle
		cx="1565"
		cy="520"
		r="10"
		stroke="currentColor"
		stroke-width="1"
	/>
	<!-- Dimension lines -->
	<line
		x1="100"
		y1="600"
		x2="1700"
		y2="600"
		stroke="currentColor"
		stroke-width="1"
		stroke-dasharray="6 3"
	/>
	<line x1="100" y1="593" x2="100" y2="607" stroke="currentColor" stroke-width="1" /><line
		x1="1700"
		y1="593"
		x2="1700"
		y2="607"
		stroke="currentColor"
		stroke-width="1"
	/>
	<text
		x="900"
		y="618"
		font-family="JetBrains Mono"
		font-size="14"
		fill="currentColor"
		text-anchor="middle">17,200 mm</text
	>
	<line
		x1="1740"
		y1="135"
		x2="1740"
		y2="540"
		stroke="currentColor"
		stroke-width="1"
		stroke-dasharray="6 3"
	/>
	<text
		x="1722"
		y="340"
		font-family="JetBrains Mono"
		font-size="12"
		fill="currentColor"
		text-anchor="end">3,500 mm</text
	>
	<line
		x1="140"
		y1="360"
		x2="1660"
		y2="360"
		stroke="currentColor"
		stroke-width="0.5"
		stroke-dasharray="20 5 2 5"
	/>
	<!-- Title block -->
	<rect x="1420" y="630" width="280" height="55" stroke="currentColor" stroke-width="1" />
	<line x1="1420" y1="648" x2="1700" y2="648" stroke="currentColor" stroke-width="0.5" />
	<line x1="1420" y1="666" x2="1700" y2="666" stroke="currentColor" stroke-width="0.5" />
	<line x1="1560" y1="630" x2="1560" y2="685" stroke="currentColor" stroke-width="0.5" />
	<text
		x="1490"
		y="643"
		font-family="JetBrains Mono"
		font-size="10"
		fill="currentColor"
		text-anchor="middle">STM BOMBARDIER</text
	>
	<text
		x="1630"
		y="643"
		font-family="JetBrains Mono"
		font-size="10"
		fill="currentColor"
		text-anchor="middle">MR-73 MOTOR CAR</text
	>
	<text
		x="1490"
		y="661"
		font-family="JetBrains Mono"
		font-size="9"
		fill="currentColor"
		text-anchor="middle">SIDE ELEVATION</text
	>
	<text
		x="1630"
		y="661"
		font-family="JetBrains Mono"
		font-size="9"
		fill="currentColor"
		text-anchor="middle">SCALE 1:48</text
	>
	<text
		x="1490"
		y="679"
		font-family="JetBrains Mono"
		font-size="9"
		fill="currentColor"
		text-anchor="middle">MONTREAL QC</text
	>
	<text
		x="1630"
		y="679"
		font-family="JetBrains Mono"
		font-size="9"
		fill="currentColor"
		text-anchor="middle">DWG MR73-001-B</text
	>
</svg>
