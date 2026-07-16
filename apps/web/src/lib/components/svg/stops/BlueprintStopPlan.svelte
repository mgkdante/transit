<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 1200 240"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	preserveAspectRatio="xMidYMid meet"
>
	<rect
		x="10"
		y="20"
		width="1180"
		height="205"
		rx="4"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="6 3"
	/>
	<path d="M34 78H1166M34 162H1166" stroke="currentColor" stroke-width="1.25" />
	<path d="M34 120H1166" stroke="currentColor" stroke-width="0.75" stroke-dasharray="18 8" />
	<path d="M128 78V162M146 78V162M836 78V162M854 78V162" stroke="currentColor" stroke-width="1" />
	<path d="M170 92H400V149H170ZM526 91H774V149H526Z" stroke="currentColor" stroke-width="1.5" />
	<path
		d="M182 103H388M538 103H762"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="6 3"
	/>
	<rect x="916" y="52" width="158" height="52" rx="3" stroke="currentColor" stroke-width="1.5" />
	<path d="M934 104V162M1056 104V162M920 118H1070" stroke="currentColor" stroke-width="1" />
	<circle cx="137" cy="120" r="18" stroke="currentColor" />
	<circle cx="845" cy="120" r="18" stroke="currentColor" />
	<path
		d="M92 45H418M498 45H800M896 32H1095"
		stroke="currentColor"
		stroke-width="0.6"
		stroke-dasharray="4 3"
	/>
	<text
		x="255"
		y="40"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="9"
		text-anchor="middle">BUS BAY 01 · HEATED SHELTER</text
	>
	<text
		x="649"
		y="40"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="9"
		text-anchor="middle">BUS BAY 02 · SIMPLE SHELTER</text
	>
	<text
		x="996"
		y="27"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="9"
		text-anchor="middle">MÉTRO ACCESS</text
	>
	<text x="28" y="215" fill="currentColor" font-family="JetBrains Mono" font-size="9"
		>STOP COMPLEX · SITE PLAN · NTS</text
	>
</svg>
