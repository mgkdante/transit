<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 200 320" fill="none" xmlns="http://www.w3.org/2000/svg">
	<text x="10" y="16" font-family="JetBrains Mono" font-size="9" fill="currentColor">SECTION D-D · INTERIOR</text>
	<rect x="5" y="22" width="190" height="290" rx="4" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>
	<path d="M30 50 Q100 30 170 50 L170 270 L30 270 Z" stroke="currentColor" stroke-width="1.5" fill="none"/>
	<rect x="45" y="70" width="110" height="70" rx="8" stroke="currentColor" stroke-width="1.5"/>
	<line x1="100" y1="70" x2="100" y2="140" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<line x1="45" y1="155" x2="155" y2="155" stroke="currentColor" stroke-width="2"/>
	<line x1="60" y1="50" x2="60" y2="155" stroke="currentColor" stroke-width="1.5"/>
	<line x1="140" y1="50" x2="140" y2="155" stroke="currentColor" stroke-width="1.5"/>
	<path d="M55 80 h10 M55 100 h10 M55 120 h10" stroke="currentColor" stroke-width="0.75"/>
	<path d="M135 80 h10 M135 100 h10 M135 120 h10" stroke="currentColor" stroke-width="0.75"/>
	<rect x="35" y="200" width="40" height="30" rx="4" stroke="currentColor" stroke-width="1.5"/>
	<line x1="35" y1="200" x2="35" y2="260" stroke="currentColor" stroke-width="1.5"/>
	<rect x="35" y="175" width="8" height="55" rx="2" stroke="currentColor" stroke-width="1"/>
	<rect x="125" y="200" width="40" height="30" rx="4" stroke="currentColor" stroke-width="1.5"/>
	<line x1="165" y1="200" x2="165" y2="260" stroke="currentColor" stroke-width="1.5"/>
	<rect x="157" y="175" width="8" height="55" rx="2" stroke="currentColor" stroke-width="1"/>
	<line x1="30" y1="260" x2="170" y2="260" stroke="currentColor" stroke-width="1.5"/>
	<path d="M75 260 v-2 h50 v2" stroke="currentColor" stroke-width="0.5"/>
	<text x="100" y="256" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="middle">AISLE 680mm</text>
	<rect x="38" y="262" width="30" height="8" rx="2" stroke="currentColor" stroke-width="0.75" stroke-dasharray="2 1"/>
	<rect x="132" y="262" width="30" height="8" rx="2" stroke="currentColor" stroke-width="0.75" stroke-dasharray="2 1"/>
	<text x="53" y="278" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="middle">HVAC</text>
	<text x="147" y="278" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="middle">HVAC</text>
	<rect x="70" y="42" width="60" height="6" rx="2" stroke="currentColor" stroke-width="0.75"/>
	<text x="100" y="40" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="middle">LIGHTING</text>
</svg>
