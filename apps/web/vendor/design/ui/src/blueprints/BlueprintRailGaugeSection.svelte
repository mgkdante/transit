<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 420 280"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	preserveAspectRatio="xMidYMid meet"
>
	<rect
		x="7"
		y="7"
		width="406"
		height="266"
		rx="3"
		stroke="currentColor"
		stroke-width="0.8"
		stroke-dasharray="5 3"
	/>
	<text x="20" y="27" fill="currentColor" font-family="JetBrains Mono" font-size="9"
		>RAIL / SLEEPER / POWER · SECTION</text
	>
	<text
		x="400"
		y="27"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="end">TRK-S03</text
	>

	<path d="M36 230L70 150H350L384 230Z" stroke="currentColor" stroke-width="1" />
	<path
		d="M48 230H372M58 214H362M64 198H356"
		stroke="currentColor"
		stroke-width="0.45"
		stroke-dasharray="5 3"
	/>
	<rect x="74" y="151" width="272" height="22" rx="2" stroke="currentColor" stroke-width="1.1" />
	<path d="M84 156H336M96 151V173M324 151V173" stroke="currentColor" stroke-width="0.45" />

	<path
		d="M104 151V113H96V103H130V113H122V151ZM250 151V113H242V103H276V113H268V151Z"
		stroke="currentColor"
		stroke-width="1.4"
	/>
	<path d="M99 103V96H127V103M245 103V96H273V103" stroke="currentColor" stroke-width="0.8" />
	<circle cx="113" cy="143" r="4" stroke="currentColor" stroke-width="0.7" />
	<circle cx="259" cy="143" r="4" stroke="currentColor" stroke-width="0.7" />

	<path d="M113 79H259M113 74V84M259 74V84" stroke="currentColor" stroke-width="0.7" />
	<path d="M113 84V96M259 84V96" stroke="currentColor" stroke-width="0.45" stroke-dasharray="3 2" />
	<text
		x="186"
		y="71"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="8"
		text-anchor="middle">1435 mm GAUGE</text
	>

	<rect x="319" y="117" width="56" height="13" rx="2" stroke="currentColor" stroke-width="1.1" />
	<path
		d="M333 130V146M361 130V146M326 146H368M347 146V166"
		stroke="currentColor"
		stroke-width="0.8"
	/>
	<circle cx="333" cy="149" r="3" stroke="currentColor" stroke-width="0.6" />
	<circle cx="361" cy="149" r="3" stroke="currentColor" stroke-width="0.6" />
	<path
		d="M375 123H397M397 123V72"
		stroke="currentColor"
		stroke-width="0.55"
		stroke-dasharray="3 2"
	/>
	<text
		x="397"
		y="62"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="end">POWER RAIL</text
	>
	<text
		x="397"
		y="71"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="6"
		text-anchor="end">750 V DC</text
	>

	<path d="M102 182H124M248 182H270M336 182H358" stroke="currentColor" stroke-width="0.65" />
	<text
		x="113"
		y="192"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="6"
		text-anchor="middle">CLIP</text
	>
	<text
		x="259"
		y="192"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="6"
		text-anchor="middle">CLIP</text
	>
	<text
		x="347"
		y="192"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="6"
		text-anchor="middle">INS.</text
	>
	<text
		x="210"
		y="254"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">BALLAST PROFILE · CONCRETE SLEEPER TYPE M-2</text
	>
</svg>
