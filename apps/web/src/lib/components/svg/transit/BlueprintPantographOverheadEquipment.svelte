<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 440 300"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	preserveAspectRatio="xMidYMid meet"
>
	<rect
		x="7"
		y="7"
		width="426"
		height="286"
		rx="3"
		stroke="currentColor"
		stroke-width="0.8"
		stroke-dasharray="5 3"
	/>
	<text x="20" y="27" fill="currentColor" font-family="JetBrains Mono" font-size="9"
		>PANTOGRAPH + O.H.E. · ELEVATION</text
	>
	<text
		x="420"
		y="27"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="end">OHE-P07</text
	>

	<path d="M44 64H395M44 70H395" stroke="currentColor" stroke-width="1.1" />
	<path
		d="M74 45C140 38 202 50 267 43C314 38 352 39 395 45"
		stroke="currentColor"
		stroke-width="0.65"
	/>
	<path
		d="M90 45V64M132 42V64M174 45V64M216 47V64M258 44V64M300 40V64M342 40V64M384 44V64"
		stroke="currentColor"
		stroke-width="0.45"
	/>
	<text
		x="220"
		y="39"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">MESSENGER</text
	>
	<text
		x="388"
		y="82"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="end">CONTACT WIRE</text
	>

	<path
		d="M150 236H308M133 244H326M149 236L133 244M309 236L326 244"
		stroke="currentColor"
		stroke-width="1.4"
	/>
	<rect x="183" y="224" width="72" height="12" rx="2" stroke="currentColor" stroke-width="1" />
	<circle cx="197" cy="230" r="3" stroke="currentColor" stroke-width="0.7" />
	<circle cx="241" cy="230" r="3" stroke="currentColor" stroke-width="0.7" />

	<path d="M190 224L267 142L206 78M248 224L171 142L232 78" stroke="currentColor" stroke-width="2" />
	<path d="M171 142H267M206 78H232" stroke="currentColor" stroke-width="1" />
	<circle cx="171" cy="142" r="4" stroke="currentColor" stroke-width="0.8" />
	<circle cx="267" cy="142" r="4" stroke="currentColor" stroke-width="0.8" />
	<circle cx="206" cy="78" r="4" stroke="currentColor" stroke-width="0.8" />
	<circle cx="232" cy="78" r="4" stroke="currentColor" stroke-width="0.8" />
	<path d="M184 76H254M174 72H264M184 76V82M254 76V82" stroke="currentColor" stroke-width="1.5" />
	<path d="M219 224V199M211 199H227M211 195H227" stroke="currentColor" stroke-width="0.75" />

	<path
		d="M340 58V244M333 58H347M333 244H347M340 96H378M340 104H378"
		stroke="currentColor"
		stroke-width="1"
	/>
	<path d="M378 96L395 70M378 104L395 70" stroke="currentColor" stroke-width="0.7" />
	<rect x="329" y="174" width="22" height="34" stroke="currentColor" stroke-width="0.8" />
	<path d="M333 181H347M333 189H347M333 197H347" stroke="currentColor" stroke-width="0.45" />

	<path d="M72 64V236M66 64H78M66 236H78" stroke="currentColor" stroke-width="0.6" />
	<text x="84" y="119" fill="currentColor" font-family="JetBrains Mono" font-size="7"
		>5.4 m NOM.</text
	>
	<text x="84" y="130" fill="currentColor" font-family="JetBrains Mono" font-size="6"
		>WIRE / ROOF</text
	>
	<text
		x="219"
		y="268"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">CAR ROOF DATUM · STATIC REACH</text
	>
</svg>
