<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 420 240"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<path d="M62 72H351L373 91H84Z" stroke="currentColor" stroke-width="2" />
	<path d="M84 91V212M351 72V212M214 72V212" stroke="currentColor" stroke-width="1.5" />
	<path d="M112 156H310V176H112ZM132 176V204M290 176V204" stroke="currentColor" />
	<path
		d="M47 212H380M62 55H351M62 49V61M351 49V61"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="5 3"
	/>
	<text
		x="206"
		y="43"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="10"
		text-anchor="middle">STANDARD CANOPY · 4 800 mm</text
	>
	<text x="62" y="229" fill="currentColor" font-family="JetBrains Mono" font-size="8"
		>SIDE ELEVATION · OPEN SHELTER</text
	>
</svg>
