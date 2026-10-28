<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 280 220"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<text x="10" y="16" font-family="JetBrains Mono" font-size="9" fill="currentColor"
		>DETAIL B · BOGIE ASSEMBLY</text
	>
	<rect
		x="5"
		y="22"
		width="270"
		height="190"
		rx="4"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="4 2"
	/>
	<rect x="30" y="80" width="220" height="50" rx="10" stroke="currentColor" stroke-width="1.5" />
	<path
		d="M60 130 v15 M80 130 v15 M200 130 v15 M220 130 v15"
		stroke="currentColor"
		stroke-width="1"
	/>
	<circle cx="80" cy="170" r="28" stroke="currentColor" stroke-width="2" /><circle
		cx="80"
		cy="170"
		r="10"
		stroke="currentColor"
		stroke-width="1"
	/><circle cx="80" cy="170" r="4" fill="currentColor" />
	<path
		d="M52 170 h-4 M108 170 h4 M80 142 v-4 M80 198 v4"
		stroke="currentColor"
		stroke-width="0.75"
	/>
	<circle cx="200" cy="170" r="28" stroke="currentColor" stroke-width="2" /><circle
		cx="200"
		cy="170"
		r="10"
		stroke="currentColor"
		stroke-width="1"
	/><circle cx="200" cy="170" r="4" fill="currentColor" />
	<path
		d="M172 170 h-4 M228 170 h4 M200 142 v-4 M200 198 v4"
		stroke="currentColor"
		stroke-width="0.75"
	/>
	<line x1="80" y1="170" x2="200" y2="170" stroke="currentColor" stroke-width="1.5" />
	<circle cx="50" cy="145" r="14" stroke="currentColor" stroke-width="1" /><circle
		cx="50"
		cy="145"
		r="5"
		stroke="currentColor"
		stroke-width="0.5"
	/>
	<circle cx="230" cy="145" r="14" stroke="currentColor" stroke-width="1" /><circle
		cx="230"
		cy="145"
		r="5"
		stroke="currentColor"
		stroke-width="0.5"
	/>
	<rect
		x="110"
		y="135"
		width="60"
		height="10"
		rx="3"
		stroke="currentColor"
		stroke-width="1"
		stroke-dasharray="3 2"
	/>
	<text
		x="140"
		y="132"
		font-family="JetBrains Mono"
		font-size="7"
		fill="currentColor"
		text-anchor="middle">3RD RAIL SHOE</text
	>
	<rect x="105" y="85" width="70" height="30" rx="6" stroke="currentColor" stroke-width="1" />
	<text
		x="140"
		y="104"
		font-family="JetBrains Mono"
		font-size="7"
		fill="currentColor"
		text-anchor="middle">174kW MOTOR</text
	>
	<line
		x1="80"
		y1="205"
		x2="200"
		y2="205"
		stroke="currentColor"
		stroke-width="0.5"
		stroke-dasharray="3 2"
	/>
	<text
		x="140"
		y="215"
		font-family="JetBrains Mono"
		font-size="7"
		fill="currentColor"
		text-anchor="middle">2,000 mm</text
	>
</svg>
