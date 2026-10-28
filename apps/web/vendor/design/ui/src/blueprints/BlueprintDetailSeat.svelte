<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 220 180" fill="none" xmlns="http://www.w3.org/2000/svg">
	<text x="10" y="16" font-family="JetBrains Mono" font-size="9" fill="currentColor">DETAIL G · SEAT MODULE</text>
	<rect x="5" y="22" width="210" height="150" rx="4" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>
	<rect x="30" y="40" width="12" height="90" rx="4" stroke="currentColor" stroke-width="1.5"/>
	<rect x="42" y="95" width="70" height="35" rx="6" stroke="currentColor" stroke-width="1.5"/>
	<path d="M50 130 v20 h55 v-20" stroke="currentColor" stroke-width="1"/>
	<line x1="50" y1="150" x2="105" y2="150" stroke="currentColor" stroke-width="1.5"/>
	<rect x="45" y="150" width="15" height="8" rx="2" stroke="currentColor" stroke-width="1"/>
	<rect x="85" y="150" width="15" height="8" rx="2" stroke="currentColor" stroke-width="1"/>
	<rect x="125" y="40" width="12" height="90" rx="4" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 2"/>
	<rect x="137" y="95" width="70" height="35" rx="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 2"/>
	<text x="170" y="85" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="middle">(MIRRORED)</text>
	<line x1="30" y1="165" x2="112" y2="165" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<text x="71" y="175" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">430 mm deep</text>
</svg>
