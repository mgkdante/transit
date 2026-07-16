<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 700 260"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	preserveAspectRatio="xMidYMid meet"
>
	<path
		d="M58 72H585Q626 72 645 112V204H44V92Q44 72 58 72Z"
		stroke="currentColor"
		stroke-width="2"
	/>
	<path d="M76 86H574Q607 86 623 116V137H76Z" stroke="currentColor" stroke-width="1.25" />
	<path
		d="M76 149H623M228 86V204M505 86V204"
		stroke="currentColor"
		stroke-width="1"
		stroke-dasharray="6 3"
	/>
	<rect x="246" y="92" width="76" height="112" rx="3" stroke="currentColor" stroke-width="1.5" />
	<line x1="284" y1="92" x2="284" y2="204" stroke="currentColor" stroke-width="0.75" />
	<rect x="514" y="92" width="76" height="112" rx="3" stroke="currentColor" stroke-width="1.5" />
	<line x1="552" y1="92" x2="552" y2="204" stroke="currentColor" stroke-width="0.75" />
	<rect x="88" y="96" width="118" height="42" rx="4" stroke="currentColor" />
	<rect x="338" y="96" width="70" height="42" rx="4" stroke="currentColor" />
	<rect x="420" y="96" width="70" height="42" rx="4" stroke="currentColor" />
	<path
		d="M87 204Q96 169 132 169Q168 169 177 204M486 204Q495 169 531 169Q567 169 576 204"
		stroke="currentColor"
		stroke-width="1.25"
	/>
	<circle cx="132" cy="204" r="27" stroke="currentColor" stroke-width="2" />
	<circle cx="132" cy="204" r="9" stroke="currentColor" />
	<circle cx="531" cy="204" r="27" stroke="currentColor" stroke-width="2" />
	<circle cx="531" cy="204" r="9" stroke="currentColor" />
	<path
		d="M74 55H596M74 49V61M596 49V61M36 227H655"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="5 3"
	/>
	<text
		x="335"
		y="48"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="10"
		text-anchor="middle">12 400 mm · LOW-FLOOR BUS</text
	>
	<text x="55" y="245" fill="currentColor" font-family="JetBrains Mono" font-size="9"
		>SIDE ELEVATION · STM URBAN FLEET</text
	>
</svg>
