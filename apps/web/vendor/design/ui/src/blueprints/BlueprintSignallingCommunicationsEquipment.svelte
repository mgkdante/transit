<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 520 280"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	preserveAspectRatio="xMidYMid meet"
>
	<rect
		x="7"
		y="7"
		width="506"
		height="266"
		rx="3"
		stroke="currentColor"
		stroke-width="0.8"
		stroke-dasharray="5 3"
	/>
	<text x="20" y="27" fill="currentColor" font-family="JetBrains Mono" font-size="9"
		>SIGNALLING + COMMUNICATIONS · EQUIPMENT</text
	>
	<text
		x="500"
		y="27"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="end">SIG-COM-12</text
	>

	<path d="M78 57V230M60 230H96M66 238H90" stroke="currentColor" stroke-width="1.5" />
	<rect x="48" y="59" width="60" height="105" rx="3" stroke="currentColor" stroke-width="1.2" />
	<circle cx="78" cy="82" r="12" stroke="currentColor" stroke-width="1" />
	<circle cx="78" cy="112" r="12" stroke="currentColor" stroke-width="1" />
	<circle cx="78" cy="142" r="12" stroke="currentColor" stroke-width="1" />
	<path
		d="M63 82H93M63 112H93M63 142H93"
		stroke="currentColor"
		stroke-width="0.4"
		stroke-dasharray="3 2"
	/>
	<text
		x="78"
		y="47"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">3-ASPECT</text
	>

	<rect x="150" y="78" width="104" height="142" rx="3" stroke="currentColor" stroke-width="1.2" />
	<path
		d="M162 94H242M162 112H242M162 130H242M162 148H242M162 166H242M162 184H242"
		stroke="currentColor"
		stroke-width="0.65"
	/>
	<circle cx="171" cy="103" r="3" stroke="currentColor" stroke-width="0.5" />
	<circle cx="171" cy="121" r="3" stroke="currentColor" stroke-width="0.5" />
	<circle cx="171" cy="139" r="3" stroke="currentColor" stroke-width="0.5" />
	<path
		d="M184 103H232M184 121H226M184 139H234"
		stroke="currentColor"
		stroke-width="0.45"
		stroke-dasharray="3 2"
	/>
	<text
		x="202"
		y="67"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">INTERLOCKING I/O</text
	>

	<rect x="282" y="78" width="104" height="142" rx="3" stroke="currentColor" stroke-width="1.2" />
	<rect x="294" y="94" width="80" height="33" stroke="currentColor" stroke-width="0.8" />
	<path d="M302 103H350M302 113H362" stroke="currentColor" stroke-width="0.5" />
	<rect x="294" y="139" width="80" height="24" stroke="currentColor" stroke-width="0.8" />
	<path d="M302 151H366" stroke="currentColor" stroke-width="0.45" stroke-dasharray="4 2" />
	<circle cx="306" cy="181" r="5" stroke="currentColor" stroke-width="0.7" />
	<circle cx="326" cy="181" r="5" stroke="currentColor" stroke-width="0.7" />
	<circle cx="346" cy="181" r="5" stroke="currentColor" stroke-width="0.7" />
	<text
		x="334"
		y="67"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">FIBRE / RADIO</text
	>

	<path
		d="M442 72V220M424 220H460M432 72H452M436 63H448"
		stroke="currentColor"
		stroke-width="1.2"
	/>
	<path
		d="M442 80C425 91 425 108 442 119M442 80C459 91 459 108 442 119"
		stroke="currentColor"
		stroke-width="0.75"
	/>
	<path
		d="M442 91C434 98 434 105 442 112M442 91C450 98 450 105 442 112"
		stroke="currentColor"
		stroke-width="0.75"
	/>
	<circle cx="442" cy="101" r="3" fill="currentColor" />
	<text
		x="442"
		y="52"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">WAYSIDE RF</text
	>

	<path
		d="M108 204H150M254 204H282M386 204H442M108 211H150M254 211H282M386 211H442"
		stroke="currentColor"
		stroke-width="0.6"
		stroke-dasharray="5 3"
	/>
	<path d="M52 247H468M52 242V252M468 242V252" stroke="currentColor" stroke-width="0.6" />
	<text
		x="260"
		y="262"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">DUAL DUCT · POWER / DATA SEPARATION</text
	>
</svg>
