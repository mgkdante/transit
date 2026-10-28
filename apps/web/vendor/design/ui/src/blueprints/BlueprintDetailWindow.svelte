<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 260 180" fill="none" xmlns="http://www.w3.org/2000/svg">
	<text x="10" y="16" font-family="JetBrains Mono" font-size="9" fill="currentColor">DETAIL F · WINDOW ASSEMBLY</text>
	<rect x="5" y="22" width="250" height="150" rx="4" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>
	<rect x="30" y="40" width="200" height="110" rx="10" stroke="currentColor" stroke-width="2"/>
	<rect x="36" y="46" width="188" height="98" rx="7" stroke="currentColor" stroke-width="1" stroke-dasharray="4 2"/>
	<rect x="42" y="52" width="176" height="86" rx="5" stroke="currentColor" stroke-width="0.75"/>
	<path d="M30 45 Q25 45 25 50 L25 145 Q25 150 30 150" stroke="currentColor" stroke-width="1.5"/>
	<path d="M230 45 Q235 45 235 50 L235 145 Q235 150 230 150" stroke="currentColor" stroke-width="1.5"/>
	<line x1="240" y1="65" x2="250" y2="55" stroke="currentColor" stroke-width="0.5"/>
	<text x="245" y="52" font-family="JetBrains Mono" font-size="5" fill="currentColor">OUTER</text>
	<line x1="240" y1="85" x2="250" y2="75" stroke="currentColor" stroke-width="0.5"/>
	<text x="245" y="72" font-family="JetBrains Mono" font-size="5" fill="currentColor">AIR GAP</text>
	<line x1="240" y1="100" x2="250" y2="95" stroke="currentColor" stroke-width="0.5"/>
	<text x="245" y="92" font-family="JetBrains Mono" font-size="5" fill="currentColor">INNER</text>
	<line x1="30" y1="160" x2="230" y2="160" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<text x="130" y="170" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">1,100 mm x 650 mm</text>
</svg>
