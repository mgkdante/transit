<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 180 300"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<circle cx="90" cy="62" r="43" stroke="currentColor" stroke-width="2" />
	<circle cx="90" cy="62" r="34" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 3" />
	<path d="M65 62H115M90 37V87" stroke="currentColor" stroke-width="1.5" />
	<path d="M90 105V270M78 270H102M72 280H108" stroke="currentColor" stroke-width="2" />
	<rect x="45" y="124" width="90" height="54" rx="3" stroke="currentColor" stroke-width="1.25" />
	<path d="M57 142H123M57 160H111" stroke="currentColor" stroke-width="0.75" />
	<path
		d="M28 19H152M28 13V25M152 13V25"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="4 3"
	/>
	<text
		x="90"
		y="10"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="8"
		text-anchor="middle">STOP IDENTIFIER</text
	>
	<text
		x="90"
		y="295"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="8"
		text-anchor="middle">TYPE P-03</text
	>
</svg>
