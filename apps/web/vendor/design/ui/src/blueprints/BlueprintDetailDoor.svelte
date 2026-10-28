<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 240 260" fill="none" xmlns="http://www.w3.org/2000/svg">
	<text x="10" y="16" font-family="JetBrains Mono" font-size="9" fill="currentColor">DETAIL C · DOOR ASSEMBLY</text>
	<rect x="5" y="22" width="230" height="230" rx="4" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>
	<rect x="40" y="40" width="160" height="200" rx="6" stroke="currentColor" stroke-width="1.5"/>
	<rect x="44" y="44" width="74" height="192" rx="3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6 3"/>
	<rect x="122" y="44" width="74" height="192" rx="3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6 3"/>
	<line x1="120" y1="44" x2="120" y2="236" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 4"/>
	<rect x="58" y="60" width="46" height="70" rx="4" stroke="currentColor" stroke-width="1"/>
	<rect x="136" y="60" width="46" height="70" rx="4" stroke="currentColor" stroke-width="1"/>
	<line x1="30" y1="38" x2="210" y2="38" stroke="currentColor" stroke-width="2"/>
	<circle cx="81" cy="38" r="4" stroke="currentColor" stroke-width="1"/><circle cx="159" cy="38" r="4" stroke="currentColor" stroke-width="1"/>
	<path d="M75 140 l-20 0 l6 -4 M75 140 l-20 0 l6 4" stroke="currentColor" stroke-width="0.75"/>
	<path d="M165 140 l20 0 l-6 -4 M165 140 l20 0 l-6 4" stroke="currentColor" stroke-width="0.75"/>
	<text x="120" y="150" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">OPEN</text>
	<rect x="40" y="238" width="160" height="6" rx="1" stroke="currentColor" stroke-width="0.75"/>
	<text x="120" y="250" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="middle">THRESHOLD PLATE</text>
	<line x1="40" y1="30" x2="200" y2="30" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<text x="120" y="28" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">1,575 mm</text>
</svg>
