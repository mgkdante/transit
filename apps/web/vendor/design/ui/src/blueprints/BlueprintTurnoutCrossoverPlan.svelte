<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 560 220"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	preserveAspectRatio="xMidYMid meet"
>
	<rect
		x="7"
		y="7"
		width="546"
		height="206"
		rx="3"
		stroke="currentColor"
		stroke-width="0.8"
		stroke-dasharray="5 3"
	/>
	<text x="20" y="25" fill="currentColor" font-family="JetBrains Mono" font-size="9"
		>TRACK TURNOUT + CROSSOVER · PLAN</text
	>
	<text
		x="538"
		y="25"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="end">SW-04 · NTS</text
	>

	<path d="M28 63H532M28 79H532M28 141H532M28 157H532" stroke="currentColor" stroke-width="1.3" />
	<path
		d="M112 79C172 79 198 141 258 141M112 63C179 63 199 157 266 157"
		stroke="currentColor"
		stroke-width="1.1"
	/>
	<path
		d="M302 141C362 141 388 79 448 79M294 157C361 157 381 63 448 63"
		stroke="currentColor"
		stroke-width="1.1"
	/>
	<path
		d="M107 55V87M113 55V87M447 55V87M453 55V87M253 133V165M259 133V165M299 133V165M305 133V165"
		stroke="currentColor"
		stroke-width="0.7"
	/>

	<path
		d="M40 57V85M56 57V85M72 57V85M88 57V85M104 57V85M120 57V85M136 57V85M152 57V85M168 57V85M184 57V85M200 57V85M216 57V85M232 57V85M248 57V85M264 57V85M280 57V85M296 57V85M312 57V85M328 57V85M344 57V85M360 57V85M376 57V85M392 57V85M408 57V85M424 57V85M440 57V85M456 57V85M472 57V85M488 57V85M504 57V85M520 57V85"
		stroke="currentColor"
		stroke-width="0.35"
	/>
	<path
		d="M40 135V163M56 135V163M72 135V163M88 135V163M104 135V163M120 135V163M136 135V163M152 135V163M168 135V163M184 135V163M200 135V163M216 135V163M232 135V163M248 135V163M264 135V163M280 135V163M296 135V163M312 135V163M328 135V163M344 135V163M360 135V163M376 135V163M392 135V163M408 135V163M424 135V163M440 135V163M456 135V163M472 135V163M488 135V163M504 135V163M520 135V163"
		stroke="currentColor"
		stroke-width="0.35"
	/>

	<rect x="92" y="94" width="52" height="18" rx="2" stroke="currentColor" stroke-width="0.8" />
	<rect x="416" y="108" width="52" height="18" rx="2" stroke="currentColor" stroke-width="0.8" />
	<path
		d="M118 94V79M442 126V141M100 103H136M424 117H460"
		stroke="currentColor"
		stroke-width="0.6"
		stroke-dasharray="3 2"
	/>
	<text
		x="118"
		y="106"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="6"
		text-anchor="middle">MOTOR A</text
	>
	<text
		x="442"
		y="120"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="6"
		text-anchor="middle">MOTOR B</text
	>

	<circle cx="258" cy="149" r="5" stroke="currentColor" stroke-width="0.7" />
	<circle cx="302" cy="149" r="5" stroke="currentColor" stroke-width="0.7" />
	<path
		d="M258 144V132M302 144V132"
		stroke="currentColor"
		stroke-width="0.5"
		stroke-dasharray="2 2"
	/>
	<text
		x="280"
		y="187"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">FOULING CLEARANCE · 3.0 m</text
	>
	<path d="M112 190H448M112 184V196M448 184V196" stroke="currentColor" stroke-width="0.55" />
	<text x="28" y="205" fill="currentColor" font-family="JetBrains Mono" font-size="6"
		>GAUGE 1435 · DOUBLE CROSSOVER</text
	>
</svg>
