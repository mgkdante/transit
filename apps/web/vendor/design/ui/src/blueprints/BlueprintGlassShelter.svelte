<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 420 260"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<path d="M68 67H332L370 96H104Z" stroke="currentColor" stroke-width="1.5" />
	<path
		d="M68 67V211H332V67M104 96V230H370V96M68 211L104 230M332 211L370 230"
		stroke="currentColor"
		stroke-width="1.5"
	/>
	<path
		d="M156 67V211M244 67V211M192 96V230M282 96V230"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="5 3"
	/>
	<path d="M129 172H285V190H129ZM145 190V211M269 190V211" stroke="currentColor" />
	<rect x="286" y="111" width="64" height="82" rx="2" stroke="currentColor" stroke-width="1" />
	<path
		d="M296 122H340M296 134H326M46 230H386"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="5 3"
	/>
	<text
		x="210"
		y="43"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="10"
		text-anchor="middle">HEATED GLASS SHELTER · ISOMETRIC</text
	>
	<text
		x="318"
		y="207"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="8"
		text-anchor="middle">INFO / HEAT</text
	>
</svg>
