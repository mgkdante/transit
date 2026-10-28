<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 250 260" fill="none" xmlns="http://www.w3.org/2000/svg">
	<!-- Title block -->
	<text x="12" y="14" font-family="JetBrains Mono" font-size="7" fill="currentColor">SECTION · ANNEAU DE VOUSSOIRS</text>
	<line x1="12" y1="17" x2="220" y2="17" stroke="currentColor" stroke-width="0.5"/>

	<!-- Border frame -->
	<rect x="4" y="22" width="242" height="234" rx="3" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>

	<!-- === OUTER ROCK CIRCLE (dashed) === -->
	<circle cx="125" cy="135" r="95" stroke="currentColor" stroke-width="0.75" stroke-dasharray="6 3"/>
	<!-- Rock texture hatching around tunnel -->
	<path d="M35 80 l-3 -5 M45 65 l-4 -4 M60 52 l-3 -5 M80 43 l-2 -5 M100 38 l-1 -5 M125 36 l0 -5 M150 38 l1 -5 M170 43 l2 -5 M190 52 l3 -5 M205 65 l4 -4 M215 80 l3 -5" stroke="currentColor" stroke-width="0.3"/>
	<path d="M35 190 l-3 5 M45 205 l-4 4 M60 218 l-3 5 M80 227 l-2 5 M100 232 l-1 5 M125 234 l0 5 M150 232 l1 5 M170 227 l2 5 M190 218 l3 5 M205 205 l4 4 M215 190 l3 5" stroke="currentColor" stroke-width="0.3"/>
	<path d="M28 100 l-5 -2 M27 120 l-5 -1 M27 140 l-5 0 M27 160 l-5 1 M28 180 l-5 2" stroke="currentColor" stroke-width="0.3"/>
	<path d="M222 100 l5 -2 M223 120 l5 -1 M223 140 l5 0 M223 160 l5 1 M222 180 l5 2" stroke="currentColor" stroke-width="0.3"/>

	<!-- === TUNNEL LINING RING (two concentric circles) === -->
	<!-- Outer lining -->
	<circle cx="125" cy="135" r="75" stroke="currentColor" stroke-width="1.5"/>
	<!-- Inner lining -->
	<circle cx="125" cy="135" r="68" stroke="currentColor" stroke-width="1"/>

	<!-- === SEGMENT DIVIDER LINES === -->
	<!-- Key segment (K) at top -->
	<line x1="113" y1="60" x2="113" y2="67" stroke="currentColor" stroke-width="0.75"/>
	<line x1="137" y1="60" x2="137" y2="67" stroke="currentColor" stroke-width="0.75"/>
	<!-- K segment arcs (short top piece) -->
	<line x1="113" y1="60.5" x2="107" y2="56" stroke="currentColor" stroke-width="0.5"/>
	<line x1="137" y1="60.5" x2="143" y2="56" stroke="currentColor" stroke-width="0.5"/>

	<!-- Segment A (upper left) -->
	<line x1="62" y1="95" x2="68" y2="100" stroke="currentColor" stroke-width="0.75"/>

	<!-- Segment B (left) -->
	<line x1="50" y1="135" x2="57" y2="135" stroke="currentColor" stroke-width="0.75"/>

	<!-- Segment C (lower left) -->
	<line x1="62" y1="175" x2="68" y2="170" stroke="currentColor" stroke-width="0.75"/>

	<!-- Segment D (bottom) -->
	<line x1="125" y1="210" x2="125" y2="203" stroke="currentColor" stroke-width="0.75"/>

	<!-- Segment E (lower right) -->
	<line x1="188" y1="175" x2="182" y2="170" stroke="currentColor" stroke-width="0.75"/>

	<!-- Segment A2 (upper right, mirror of A) -->
	<line x1="188" y1="95" x2="182" y2="100" stroke="currentColor" stroke-width="0.75"/>

	<!-- Segment B2 (right, mirror of B) -->
	<line x1="200" y1="135" x2="193" y2="135" stroke="currentColor" stroke-width="0.75"/>

	<!-- Extended divider lines through lining thickness -->
	<line x1="107" y1="56" x2="104" y2="50" stroke="currentColor" stroke-width="0.5"/>
	<line x1="143" y1="56" x2="146" y2="50" stroke="currentColor" stroke-width="0.5"/>
	<line x1="56" y1="90" x2="62" y2="95" stroke="currentColor" stroke-width="0.5"/>
	<line x1="44" y1="135" x2="50" y2="135" stroke="currentColor" stroke-width="0.5"/>
	<line x1="56" y1="180" x2="62" y2="175" stroke="currentColor" stroke-width="0.5"/>
	<line x1="125" y1="216" x2="125" y2="210" stroke="currentColor" stroke-width="0.5"/>
	<line x1="194" y1="180" x2="188" y2="175" stroke="currentColor" stroke-width="0.5"/>
	<line x1="194" y1="90" x2="188" y2="95" stroke="currentColor" stroke-width="0.5"/>
	<line x1="206" y1="135" x2="200" y2="135" stroke="currentColor" stroke-width="0.5"/>

	<!-- === SEGMENT LABELS === -->
	<text x="125" y="72" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle" font-weight="bold">K</text>
	<text x="82" y="100" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">A</text>
	<text x="72" y="140" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">B</text>
	<text x="82" y="178" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">C</text>
	<text x="125" y="200" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">D</text>
	<text x="168" y="178" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">E</text>
	<text x="178" y="140" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">B'</text>
	<text x="168" y="100" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">A'</text>

	<!-- === INVERT CURVE AT BOTTOM === -->
	<path d="M80 198 Q 125 220 170 198" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>

	<!-- === CENTER MARK === -->
	<circle cx="125" cy="135" r="2" fill="currentColor"/>
	<line x1="120" y1="135" x2="130" y2="135" stroke="currentColor" stroke-width="0.5"/>
	<line x1="125" y1="130" x2="125" y2="140" stroke="currentColor" stroke-width="0.5"/>

	<!-- === DIAMETER DIMENSION === -->
	<!-- Horizontal diameter line -->
	<line x1="30" y1="135" x2="220" y2="135" stroke="currentColor" stroke-width="0.3" stroke-dasharray="8 3 2 3"/>

	<!-- Vertical diameter dimension (left side) -->
	<line x1="18" y1="60" x2="18" y2="210" stroke="currentColor" stroke-width="0.4"/>
	<line x1="14" y1="60" x2="22" y2="60" stroke="currentColor" stroke-width="0.4"/>
	<line x1="14" y1="210" x2="22" y2="210" stroke="currentColor" stroke-width="0.4"/>
	<text x="16" y="140" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="middle" transform="rotate(-90 16 140)">&#216; 9.4m</text>

	<!-- Inner diameter dimension -->
	<line x1="57" y1="224" x2="193" y2="224" stroke="currentColor" stroke-width="0.4"/>
	<line x1="57" y1="220" x2="57" y2="228" stroke="currentColor" stroke-width="0.4"/>
	<line x1="193" y1="220" x2="193" y2="228" stroke="currentColor" stroke-width="0.4"/>
	<text x="125" y="232" font-family="JetBrains Mono" font-size="5.5" fill="currentColor" text-anchor="middle">&#216;i 8.6m</text>

	<!-- Lining thickness callout -->
	<line x1="195" y1="80" x2="215" y2="65" stroke="currentColor" stroke-width="0.3"/>
	<text x="218" y="64" font-family="JetBrains Mono" font-size="5" fill="currentColor">e = 400mm</text>

	<!-- === GROUT INJECTION POINTS (small dots between lining and rock) === -->
	<circle cx="125" cy="43" r="1.5" fill="currentColor"/>
	<circle cx="82" cy="52" r="1.5" fill="currentColor"/>
	<circle cx="168" cy="52" r="1.5" fill="currentColor"/>
	<circle cx="40" cy="105" r="1.5" fill="currentColor"/>
	<circle cx="210" cy="105" r="1.5" fill="currentColor"/>
	<circle cx="40" cy="165" r="1.5" fill="currentColor"/>
	<circle cx="210" cy="165" r="1.5" fill="currentColor"/>
	<circle cx="82" cy="218" r="1.5" fill="currentColor"/>
	<circle cx="168" cy="218" r="1.5" fill="currentColor"/>
	<circle cx="125" cy="227" r="1.5" fill="currentColor"/>

	<!-- Grout label -->
	<line x1="214" y1="165" x2="230" y2="175" stroke="currentColor" stroke-width="0.3"/>
	<text x="220" y="183" font-family="JetBrains Mono" font-size="4.5" fill="currentColor">INJECTION</text>
	<text x="220" y="189" font-family="JetBrains Mono" font-size="4.5" fill="currentColor">DE COULIS</text>

	<!-- === MATERIAL HATCHING in lining (cross-hatch pattern in key segment) === -->
	<path d="M115 62 l2 4 M119 62 l2 4 M123 62 l2 4 M127 62 l2 4 M131 62 l2 4 M135 62 l2 4" stroke="currentColor" stroke-width="0.2"/>

	<!-- Scale reference -->
	<text x="175" y="14" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="end">&#201;CH. 1:50</text>

	<!-- Drawing number -->
	<text x="236" y="14" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="end">DWG VS-001</text>

	<!-- Ring number annotation -->
	<text x="125" y="248" font-family="JetBrains Mono" font-size="5.5" fill="currentColor" text-anchor="middle">ANNEAU TYPE 7+1 · LARGEUR 1.5m</text>
</svg>
