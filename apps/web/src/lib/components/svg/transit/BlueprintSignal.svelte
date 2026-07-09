<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 120 200"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<!-- Title block -->
	<text x="6" y="12" font-family="JetBrains Mono" font-size="6" fill="currentColor"
		>SIGNAL · TYPE SA-2</text
	>
	<line x1="6" y1="15" x2="95" y2="15" stroke="currentColor" stroke-width="0.5" />

	<!-- Border frame -->
	<rect
		x="3"
		y="18"
		width="114"
		height="178"
		rx="4"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="4 2"
	/>

	<!-- Mounting pole (vertical) -->
	<line x1="60" y1="62" x2="60" y2="170" stroke="currentColor" stroke-width="1.5" />

	<!-- Pole flange detail -->
	<rect x="56" y="60" width="8" height="4" stroke="currentColor" stroke-width="0.5" fill="none" />

	<!-- Base plate -->
	<line x1="40" y1="170" x2="80" y2="170" stroke="currentColor" stroke-width="1.5" />
	<line x1="42" y1="173" x2="78" y2="173" stroke="currentColor" stroke-width="0.75" />

	<!-- Foundation hatching -->
	<path
		d="M42 173 l-4 6 M48 173 l-4 6 M54 173 l-4 6 M60 173 l-4 6 M66 173 l-4 6 M72 173 l-4 6 M78 173 l-4 6"
		stroke="currentColor"
		stroke-width="0.3"
	/>

	<!-- Base bolts -->
	<circle cx="45" cy="170" r="1.5" stroke="currentColor" stroke-width="0.5" fill="none" />
	<circle cx="75" cy="170" r="1.5" stroke="currentColor" stroke-width="0.5" fill="none" />

	<!-- Signal head housing -->
	<rect x="40" y="26" width="40" height="36" rx="3" stroke="currentColor" stroke-width="1.2" />

	<!-- Signal head back plate detail -->
	<rect
		x="42"
		y="28"
		width="36"
		height="32"
		rx="2"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="2 2"
	/>

	<!-- Visor / hood at top -->
	<path d="M38 26 L42 22 L78 22 L82 26" stroke="currentColor" stroke-width="0.75" fill="none" />

	<!-- Upper aspect — Rouge (R) -->
	<circle cx="60" cy="36" r="6" stroke="currentColor" stroke-width="1" />
	<circle cx="60" cy="36" r="4" stroke="currentColor" stroke-width="0.5" />
	<circle cx="60" cy="36" r="1.5" fill="currentColor" />
	<text
		x="60"
		y="38"
		font-family="JetBrains Mono"
		font-size="4"
		fill="currentColor"
		text-anchor="middle"
		dy="-6">R</text
	>

	<!-- Lower aspect — Vert (V) -->
	<circle cx="60" cy="52" r="6" stroke="currentColor" stroke-width="1" />
	<circle cx="60" cy="52" r="4" stroke="currentColor" stroke-width="0.5" />
	<circle cx="60" cy="52" r="1.5" fill="currentColor" />
	<text
		x="60"
		y="54"
		font-family="JetBrains Mono"
		font-size="4"
		fill="currentColor"
		text-anchor="middle"
		dy="-6">V</text
	>

	<!-- Indicator arm — left -->
	<line x1="40" y1="36" x2="25" y2="36" stroke="currentColor" stroke-width="0.75" />
	<line x1="25" y1="33" x2="25" y2="39" stroke="currentColor" stroke-width="0.5" />
	<!-- Indicator lamp -->
	<circle cx="25" cy="36" r="2" stroke="currentColor" stroke-width="0.5" fill="none" />

	<!-- Indicator arm — right -->
	<line x1="80" y1="52" x2="95" y2="52" stroke="currentColor" stroke-width="0.75" />
	<line x1="95" y1="49" x2="95" y2="55" stroke="currentColor" stroke-width="0.5" />
	<!-- Indicator lamp -->
	<circle cx="95" cy="52" r="2" stroke="currentColor" stroke-width="0.5" fill="none" />

	<!-- Cable conduit along pole -->
	<line
		x1="63"
		y1="62"
		x2="63"
		y2="160"
		stroke="currentColor"
		stroke-width="0.3"
		stroke-dasharray="3 2"
	/>

	<!-- Junction box on pole -->
	<rect
		x="64"
		y="100"
		width="10"
		height="8"
		rx="1"
		stroke="currentColor"
		stroke-width="0.5"
		fill="none"
	/>
	<text
		x="69"
		y="106"
		font-family="JetBrains Mono"
		font-size="3"
		fill="currentColor"
		text-anchor="middle">JB</text
	>

	<!-- Ladder rungs -->
	<line x1="55" y1="80" x2="65" y2="80" stroke="currentColor" stroke-width="0.3" />
	<line x1="55" y1="90" x2="65" y2="90" stroke="currentColor" stroke-width="0.3" />
	<line x1="55" y1="120" x2="65" y2="120" stroke="currentColor" stroke-width="0.3" />
	<line x1="55" y1="130" x2="65" y2="130" stroke="currentColor" stroke-width="0.3" />
	<line x1="55" y1="140" x2="65" y2="140" stroke="currentColor" stroke-width="0.3" />
	<line x1="55" y1="150" x2="65" y2="150" stroke="currentColor" stroke-width="0.3" />

	<!-- Reference label -->
	<text
		x="60"
		y="186"
		font-family="JetBrains Mono"
		font-size="7"
		fill="currentColor"
		text-anchor="middle">SIG-07A</text
	>

	<!-- Height dimension (left side) -->
	<line x1="16" y1="26" x2="16" y2="170" stroke="currentColor" stroke-width="0.3" />
	<line x1="13" y1="26" x2="19" y2="26" stroke="currentColor" stroke-width="0.3" />
	<line x1="13" y1="170" x2="19" y2="170" stroke="currentColor" stroke-width="0.3" />
	<text
		x="14"
		y="105"
		font-family="JetBrains Mono"
		font-size="4"
		fill="currentColor"
		text-anchor="middle"
		transform="rotate(-90 14 105)">H = 6,3 m</text
	>

	<!-- Signal head width dimension -->
	<line x1="40" y1="68" x2="80" y2="68" stroke="currentColor" stroke-width="0.3" />
	<line x1="40" y1="65" x2="40" y2="71" stroke="currentColor" stroke-width="0.3" />
	<line x1="80" y1="65" x2="80" y2="71" stroke="currentColor" stroke-width="0.3" />
	<text
		x="60"
		y="74"
		font-family="JetBrains Mono"
		font-size="4"
		fill="currentColor"
		text-anchor="middle">400 mm</text
	>

	<!-- Aspect spacing dimension (right side) -->
	<line x1="105" y1="36" x2="105" y2="52" stroke="currentColor" stroke-width="0.3" />
	<line x1="102" y1="36" x2="108" y2="36" stroke="currentColor" stroke-width="0.3" />
	<line x1="102" y1="52" x2="108" y2="52" stroke="currentColor" stroke-width="0.3" />
	<text x="110" y="46" font-family="JetBrains Mono" font-size="4" fill="currentColor">200</text>

	<!-- Drawing info -->
	<text
		x="110"
		y="12"
		font-family="JetBrains Mono"
		font-size="4"
		fill="currentColor"
		text-anchor="end">DWG SA-2-004</text
	>

	<!-- Signal type plate -->
	<rect
		x="50"
		y="155"
		width="20"
		height="8"
		rx="1"
		stroke="currentColor"
		stroke-width="0.4"
		fill="none"
	/>
	<text
		x="60"
		y="161"
		font-family="JetBrains Mono"
		font-size="3.5"
		fill="currentColor"
		text-anchor="middle">SA-2</text
	>

	<!-- Grounding symbol at base -->
	<line x1="60" y1="173" x2="60" y2="176" stroke="currentColor" stroke-width="0.5" />
	<line x1="56" y1="176" x2="64" y2="176" stroke="currentColor" stroke-width="0.5" />
	<line x1="57" y1="177.5" x2="63" y2="177.5" stroke="currentColor" stroke-width="0.4" />
	<line x1="58" y1="179" x2="62" y2="179" stroke="currentColor" stroke-width="0.3" />
</svg>
