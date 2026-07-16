<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 620 280"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	preserveAspectRatio="xMidYMid meet"
>
	<rect
		x="7"
		y="7"
		width="606"
		height="266"
		rx="3"
		stroke="currentColor"
		stroke-width="0.8"
		stroke-dasharray="5 3"
	/>
	<text x="20" y="27" fill="currentColor" font-family="JetBrains Mono" font-size="9"
		>MÉTRO PLATFORM + CIRCULATION · PLAN</text
	>
	<text
		x="600"
		y="27"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="end">PLT-C02</text
	>

	<path d="M32 55H588M32 83H588M32 197H588M32 225H588" stroke="currentColor" stroke-width="1.2" />
	<path
		d="M32 69H588M32 211H588"
		stroke="currentColor"
		stroke-width="0.45"
		stroke-dasharray="10 5"
	/>
	<rect x="58" y="88" width="504" height="104" rx="3" stroke="currentColor" stroke-width="1.2" />
	<path
		d="M58 99H562M58 181H562"
		stroke="currentColor"
		stroke-width="0.65"
		stroke-dasharray="4 3"
	/>

	<rect x="116" y="111" width="82" height="58" stroke="currentColor" stroke-width="0.9" />
	<path
		d="M124 119H190M124 127H190M124 135H190M124 143H190M124 151H190M124 159H190"
		stroke="currentColor"
		stroke-width="0.5"
	/>
	<path d="M157 119V159M150 126L157 119L164 126" stroke="currentColor" stroke-width="0.75" />
	<text
		x="157"
		y="106"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">STAIR A</text
	>

	<rect x="230" y="111" width="92" height="58" stroke="currentColor" stroke-width="0.9" />
	<path d="M242 121L310 159M242 159L310 121" stroke="currentColor" stroke-width="0.8" />
	<path
		d="M250 121L257 121L253 128M302 159L295 159L299 152"
		stroke="currentColor"
		stroke-width="0.7"
	/>
	<text
		x="276"
		y="106"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">ESCALATORS</text
	>

	<rect x="354" y="111" width="54" height="58" stroke="currentColor" stroke-width="0.9" />
	<path d="M363 120H399V160H363ZM381 120V160" stroke="currentColor" stroke-width="0.55" />
	<circle
		cx="381"
		cy="140"
		r="10"
		stroke="currentColor"
		stroke-width="0.55"
		stroke-dasharray="3 2"
	/>
	<text
		x="381"
		y="106"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">LIFT</text
	>

	<rect x="444" y="111" width="70" height="58" stroke="currentColor" stroke-width="0.9" />
	<path
		d="M455 121H503M455 132H503M455 143H503M455 154H503"
		stroke="currentColor"
		stroke-width="0.5"
	/>
	<text
		x="479"
		y="106"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">STAIR B</text
	>

	<path
		d="M82 140H105M98 133L105 140L98 147M207 140H222M215 133L222 140L215 147M417 140H435M428 133L435 140L428 147M522 140H545M538 133L545 140L538 147"
		stroke="currentColor"
		stroke-width="0.8"
	/>
	<circle cx="92" cy="107" r="4" fill="currentColor" />
	<circle cx="216" cy="173" r="4" fill="currentColor" />
	<circle cx="429" cy="107" r="4" fill="currentColor" />
	<circle cx="530" cy="173" r="4" fill="currentColor" />
	<path d="M58 245H562M58 239V251M562 239V251" stroke="currentColor" stroke-width="0.6" />
	<text
		x="310"
		y="261"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">PLATFORM 152 m · CLEAR PATH 1.8 m MIN.</text
	>
</svg>
