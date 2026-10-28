<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 500 300"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	preserveAspectRatio="xMidYMid meet"
>
	<rect
		x="7"
		y="7"
		width="486"
		height="286"
		rx="3"
		stroke="currentColor"
		stroke-width="0.8"
		stroke-dasharray="5 3"
	/>
	<text x="20" y="27" fill="currentColor" font-family="JetBrains Mono" font-size="9"
		>ACCESSIBLE BUS CURB + BOARDING · SECTION</text
	>
	<text
		x="480"
		y="27"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="end">CURB-A08</text
	>

	<path d="M28 228H202L218 206H452" stroke="currentColor" stroke-width="1.5" />
	<path d="M28 237H190L218 215H452" stroke="currentColor" stroke-width="0.65" />
	<path
		d="M48 228L83 237M98 228L133 237M148 228L183 237M239 215L253 228M266 215L280 228M293 215L307 228M320 215L334 228M347 215L361 228M374 215L388 228M401 215L415 228"
		stroke="currentColor"
		stroke-width="0.45"
	/>

	<path d="M74 161H206V207H74Z" stroke="currentColor" stroke-width="1.2" />
	<path d="M86 171H128V195H86ZM140 171H194V195H140Z" stroke="currentColor" stroke-width="0.8" />
	<circle cx="103" cy="209" r="18" stroke="currentColor" stroke-width="1.2" />
	<circle cx="178" cy="209" r="18" stroke="currentColor" stroke-width="1.2" />
	<path d="M74 207H206M206 183H224M224 183V206" stroke="currentColor" stroke-width="0.9" />
	<text
		x="140"
		y="151"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">LOW-FLOOR DATUM</text
	>

	<path d="M224 206H274L304 228" stroke="currentColor" stroke-width="1" />
	<path d="M232 202H278L311 226" stroke="currentColor" stroke-width="0.55" stroke-dasharray="4 2" />
	<path d="M224 178V206M218 178H230M218 206H230" stroke="currentColor" stroke-width="0.6" />
	<text x="236" y="190" fill="currentColor" font-family="JetBrains Mono" font-size="7">150 mm</text>

	<circle cx="350" cy="145" r="14" stroke="currentColor" stroke-width="1" />
	<circle cx="346" cy="124" r="6" stroke="currentColor" stroke-width="1" />
	<path
		d="M346 130L350 162L372 181M350 145L366 145M350 161L337 182"
		stroke="currentColor"
		stroke-width="1"
	/>
	<circle cx="348" cy="181" r="22" stroke="currentColor" stroke-width="1" />
	<path d="M366 181H389" stroke="currentColor" stroke-width="1" />
	<path d="M328 206H412M328 199V213M412 199V213" stroke="currentColor" stroke-width="0.6" />
	<text
		x="370"
		y="224"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">CLEAR 1.50 m</text
	>

	<path d="M250 191H321" stroke="currentColor" stroke-width="0.75" stroke-dasharray="3 2" />
	<circle cx="265" cy="198" r="3" fill="currentColor" />
	<circle cx="279" cy="198" r="3" fill="currentColor" />
	<circle cx="293" cy="198" r="3" fill="currentColor" />
	<circle cx="307" cy="198" r="3" fill="currentColor" />
	<text
		x="286"
		y="182"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">TACTILE BAND</text
	>
	<text
		x="250"
		y="271"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">ROAD / CURB / BOARDING PLATFORM · 1:20</text
	>
</svg>
