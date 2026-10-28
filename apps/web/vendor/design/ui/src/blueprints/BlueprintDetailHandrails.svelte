<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 180 300" fill="none" xmlns="http://www.w3.org/2000/svg">
	<text x="10" y="16" font-family="JetBrains Mono" font-size="9" fill="currentColor">DETAIL E · HANDRAILS</text>
	<rect x="5" y="22" width="170" height="270" rx="4" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>
	<rect x="60" y="40" width="60" height="12" rx="3" stroke="currentColor" stroke-width="1.5"/>
	<text x="90" y="38" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="middle">CEILING MOUNT</text>
	<line x1="90" y1="52" x2="90" y2="270" stroke="currentColor" stroke-width="3"/>
	<circle cx="90" cy="52" r="6" stroke="currentColor" stroke-width="1"/><circle cx="90" cy="52" r="2" fill="currentColor"/>
	<path d="M75 90 Q75 75 90 75 Q105 75 105 90" stroke="currentColor" stroke-width="1.5" fill="none"/>
	<path d="M75 130 Q75 115 90 115 Q105 115 105 130" stroke="currentColor" stroke-width="1.5" fill="none"/>
	<path d="M75 170 Q75 155 90 155 Q105 155 105 170" stroke="currentColor" stroke-width="1.5" fill="none"/>
	<line x1="30" y1="200" x2="150" y2="200" stroke="currentColor" stroke-width="2.5"/>
	<circle cx="30" cy="200" r="5" stroke="currentColor" stroke-width="1"/><circle cx="150" cy="200" r="5" stroke="currentColor" stroke-width="1"/>
	<rect x="20" y="195" width="15" height="10" rx="2" stroke="currentColor" stroke-width="1"/>
	<rect x="145" y="195" width="15" height="10" rx="2" stroke="currentColor" stroke-width="1"/>
	<g transform="translate(40, 210)">
		<rect x="0" y="0" width="16" height="3" rx="1" stroke="currentColor" stroke-width="0.75"/>
		<path d="M3 3 v18 Q3 28 8 28 Q13 28 13 21 v-18" stroke="currentColor" stroke-width="1"/>
	</g>
	<g transform="translate(70, 210)">
		<rect x="0" y="0" width="16" height="3" rx="1" stroke="currentColor" stroke-width="0.75"/>
		<path d="M3 3 v18 Q3 28 8 28 Q13 28 13 21 v-18" stroke="currentColor" stroke-width="1"/>
	</g>
	<g transform="translate(100, 210)">
		<rect x="0" y="0" width="16" height="3" rx="1" stroke="currentColor" stroke-width="0.75"/>
		<path d="M3 3 v18 Q3 28 8 28 Q13 28 13 21 v-18" stroke="currentColor" stroke-width="1"/>
	</g>
	<text x="90" y="255" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">STRAP HANDLES (typ.)</text>
	<line x1="30" y1="265" x2="150" y2="265" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<text x="90" y="275" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">1,200 mm</text>
</svg>
