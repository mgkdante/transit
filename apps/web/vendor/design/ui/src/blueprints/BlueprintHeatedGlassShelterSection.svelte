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
		>HEATED GLASS SHELTER · SECTION</text
	>
	<text
		x="420"
		y="27"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="end">SHT-H05</text
	>

	<path d="M72 71H356L376 89H92Z" stroke="currentColor" stroke-width="1.4" />
	<path d="M92 89V242M356 71V242M72 71V242" stroke="currentColor" stroke-width="1.4" />
	<path d="M72 242H376M54 248H394" stroke="currentColor" stroke-width="1" />
	<path
		d="M112 89V242M194 89V242M276 89V242"
		stroke="currentColor"
		stroke-width="0.7"
		stroke-dasharray="6 3"
	/>
	<path
		d="M82 99H346M82 232H346"
		stroke="currentColor"
		stroke-width="0.45"
		stroke-dasharray="4 3"
	/>

	<rect x="132" y="179" width="142" height="18" rx="2" stroke="currentColor" stroke-width="1" />
	<path d="M146 197V225M260 197V225M132 184H274" stroke="currentColor" stroke-width="0.8" />
	<rect x="294" y="121" width="44" height="75" rx="2" stroke="currentColor" stroke-width="0.9" />
	<path d="M304 132H328M304 143H328M304 154H328" stroke="currentColor" stroke-width="0.5" />
	<path d="M316 196V215M306 215H326" stroke="currentColor" stroke-width="0.65" />

	<rect x="101" y="112" width="18" height="52" rx="2" stroke="currentColor" stroke-width="0.9" />
	<path
		d="M106 121C116 126 116 134 106 139M106 143C116 148 116 156 106 161"
		stroke="currentColor"
		stroke-width="0.6"
	/>
	<path
		d="M119 138H144M144 132V144"
		stroke="currentColor"
		stroke-width="0.55"
		stroke-dasharray="3 2"
	/>
	<text x="151" y="136" fill="currentColor" font-family="JetBrains Mono" font-size="7"
		>RADIANT HEAT</text
	>

	<path d="M44 71V242M38 71H50M38 242H50" stroke="currentColor" stroke-width="0.6" />
	<text x="20" y="148" fill="currentColor" font-family="JetBrains Mono" font-size="7">2.35 m</text>
	<path d="M72 266H356M72 260V272M356 260V272" stroke="currentColor" stroke-width="0.6" />
	<text
		x="214"
		y="283"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">4.80 m · TEMPERED PANELS</text
	>
</svg>
