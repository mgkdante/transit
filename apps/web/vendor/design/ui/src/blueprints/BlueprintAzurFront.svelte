<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 500 650" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
	<!-- ===== CONCRETE ROLLWAYS ===== -->
	<rect x="110" y="525" width="70" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
	<rect x="320" y="525" width="70" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/>
	<!-- Rollway surface hatching -->
	<g stroke="currentColor" stroke-width="0.5" opacity="0.4">
		<line x1="115" y1="531" x2="125" y2="525"/><line x1="125" y1="531" x2="135" y2="525"/><line x1="135" y1="531" x2="145" y2="525"/><line x1="145" y1="531" x2="155" y2="525"/><line x1="155" y1="531" x2="165" y2="525"/><line x1="165" y1="531" x2="175" y2="525"/>
		<line x1="325" y1="531" x2="335" y2="525"/><line x1="335" y1="531" x2="345" y2="525"/><line x1="345" y1="531" x2="355" y2="525"/><line x1="355" y1="531" x2="365" y2="525"/><line x1="365" y1="531" x2="375" y2="525"/><line x1="375" y1="531" x2="385" y2="525"/>
	</g>

	<!-- ===== STEEL RAILS (center) ===== -->
	<rect x="213" y="528" width="8" height="9" stroke="currentColor" stroke-width="1.5"/>
	<line x1="210" y1="537" x2="224" y2="537" stroke="currentColor" stroke-width="2"/>
	<rect x="279" y="528" width="8" height="9" stroke="currentColor" stroke-width="1.5"/>
	<line x1="276" y1="537" x2="290" y2="537" stroke="currentColor" stroke-width="2"/>

	<!-- ===== GUIDE BARS ===== -->
	<rect x="95" y="510" width="12" height="30" rx="1" stroke="currentColor" stroke-width="1" stroke-dasharray="4 2"/>
	<rect x="393" y="510" width="12" height="30" rx="1" stroke="currentColor" stroke-width="1" stroke-dasharray="4 2"/>

	<!-- ===== RUBBER TIRES (2 per side) ===== -->
	<!-- Left side tires -->
	<circle cx="130" cy="510" r="20" stroke="currentColor" stroke-width="2"/>
	<circle cx="130" cy="510" r="12" stroke="currentColor" stroke-width="1"/>
	<circle cx="130" cy="510" r="4" fill="currentColor"/>
	<circle cx="165" cy="510" r="20" stroke="currentColor" stroke-width="2"/>
	<circle cx="165" cy="510" r="12" stroke="currentColor" stroke-width="1"/>
	<circle cx="165" cy="510" r="4" fill="currentColor"/>
	<!-- Right side tires -->
	<circle cx="335" cy="510" r="20" stroke="currentColor" stroke-width="2"/>
	<circle cx="335" cy="510" r="12" stroke="currentColor" stroke-width="1"/>
	<circle cx="335" cy="510" r="4" fill="currentColor"/>
	<circle cx="370" cy="510" r="20" stroke="currentColor" stroke-width="2"/>
	<circle cx="370" cy="510" r="12" stroke="currentColor" stroke-width="1"/>
	<circle cx="370" cy="510" r="4" fill="currentColor"/>

	<!-- ===== GUIDE WHEELS (small, horizontal against guide bars) ===== -->
	<ellipse cx="107" cy="518" rx="6" ry="8" stroke="currentColor" stroke-width="1"/>
	<circle cx="107" cy="518" r="2" fill="currentColor"/>
	<ellipse cx="393" cy="518" rx="6" ry="8" stroke="currentColor" stroke-width="1"/>
	<circle cx="393" cy="518" r="2" fill="currentColor"/>

	<!-- ===== SAFETY STEEL WHEELS (small, on center rails) ===== -->
	<circle cx="217" cy="524" r="7" stroke="currentColor" stroke-width="1"/>
	<circle cx="217" cy="524" r="2.5" fill="currentColor"/>
	<circle cx="283" cy="524" r="7" stroke="currentColor" stroke-width="1"/>
	<circle cx="283" cy="524" r="2.5" fill="currentColor"/>

	<!-- ===== BOGIE FRAME ===== -->
	<rect x="105" y="485" width="80" height="10" rx="3" stroke="currentColor" stroke-width="1.5"/>
	<rect x="315" y="485" width="80" height="10" rx="3" stroke="currentColor" stroke-width="1.5"/>
	<!-- Bogie cross-beam -->
	<line x1="185" y1="490" x2="315" y2="490" stroke="currentColor" stroke-width="1" stroke-dasharray="6 3"/>

	<!-- ===== CAR BODY OUTER SHELL ===== -->
	<!-- Main body: tapered/aerodynamic front face -->
	<path d="
		M 90 475
		L 90 200
		Q 90 140 130 105
		Q 180 68 250 55
		Q 320 68 370 105
		Q 410 140 410 200
		L 410 475
		Z
	" stroke="currentColor" stroke-width="2"/>

	<!-- Body taper lines showing inward curve from full width -->
	<line x1="75" y1="475" x2="90" y2="340" stroke="currentColor" stroke-width="1" stroke-dasharray="6 3"/>
	<line x1="425" y1="475" x2="410" y2="340" stroke="currentColor" stroke-width="1" stroke-dasharray="6 3"/>
	<!-- Full body width reference (dashed, behind the tapered face) -->
	<line x1="75" y1="475" x2="75" y2="200" stroke="currentColor" stroke-width="0.5" stroke-dasharray="4 4"/>
	<line x1="425" y1="475" x2="425" y2="200" stroke="currentColor" stroke-width="0.5" stroke-dasharray="4 4"/>
	<path d="M 75 200 Q 75 120 130 85 Q 185 50 250 40 Q 315 50 370 85 Q 425 120 425 200" stroke="currentColor" stroke-width="0.5" stroke-dasharray="4 4"/>

	<!-- ===== LED DESTINATION SIGN ===== -->
	<rect x="175" y="72" width="150" height="24" rx="4" stroke="currentColor" stroke-width="1.5"/>
	<!-- Screen inner border -->
	<rect x="180" y="76" width="140" height="16" rx="2" stroke="currentColor" stroke-width="0.5"/>
	<!-- Destination text -->
	<text x="250" y="88" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">123 Cote-Vertu</text>

	<!-- ===== CURVED WINDSHIELD (panoramic, from roof to ~60% height) ===== -->
	<path d="
		M 130 108
		Q 130 102 145 100
		L 250 96
		L 355 100
		Q 370 102 370 108
		L 370 320
		Q 370 340 350 345
		L 250 350
		L 150 345
		Q 130 340 130 320
		Z
	" stroke="currentColor" stroke-width="1.5"/>
	<!-- Windshield inner gasket line -->
	<path d="
		M 138 114
		Q 138 110 150 108
		L 250 104
		L 350 108
		Q 362 110 362 114
		L 362 314
		Q 362 330 345 334
		L 250 338
		L 155 334
		Q 138 330 138 314
		Z
	" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<!-- Windshield reflection lines -->
	<line x1="180" y1="130" x2="160" y2="280" stroke="currentColor" stroke-width="0.5" opacity="0.3"/>
	<line x1="210" y1="125" x2="190" y2="290" stroke="currentColor" stroke-width="0.5" opacity="0.3"/>
	<!-- Wiper (resting position) -->
	<line x1="250" y1="340" x2="200" y2="200" stroke="currentColor" stroke-width="0.75" opacity="0.5"/>
	<circle cx="250" cy="342" r="3" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>

	<!-- ===== STM LOGO (stylized arrow/chevron) ===== -->
	<g transform="translate(250, 395)" stroke="currentColor" stroke-width="1.5">
		<!-- Outer circle -->
		<circle cx="0" cy="0" r="22" stroke-width="1.5"/>
		<!-- STM arrow/chevron pointing right -->
		<path d="M -12 -10 L 8 0 L -12 10" stroke-width="2" stroke-linejoin="round"/>
		<!-- Horizontal bar through chevron -->
		<line x1="-14" y1="0" x2="12" y2="0" stroke-width="1"/>
	</g>

	<!-- ===== FRONT PANEL DETAILS ===== -->
	<!-- Horizontal body line below windshield -->
	<line x1="100" y1="360" x2="400" y2="360" stroke="currentColor" stroke-width="1" opacity="0.5"/>
	<!-- Lower body panel line -->
	<line x1="95" y1="430" x2="405" y2="430" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>

	<!-- ===== HEADLIGHT / TAILLIGHT BAR (continuous horizontal LED strip) ===== -->
	<rect x="105" y="455" width="290" height="8" rx="4" stroke="currentColor" stroke-width="1.5"/>
	<!-- LED segments -->
	<g stroke="currentColor" stroke-width="0.5" opacity="0.5">
		<line x1="130" y1="456" x2="130" y2="462"/><line x1="155" y1="456" x2="155" y2="462"/><line x1="180" y1="456" x2="180" y2="462"/><line x1="205" y1="456" x2="205" y2="462"/><line x1="230" y1="456" x2="230" y2="462"/><line x1="250" y1="456" x2="250" y2="462"/><line x1="270" y1="456" x2="270" y2="462"/><line x1="295" y1="456" x2="295" y2="462"/><line x1="320" y1="456" x2="320" y2="462"/><line x1="345" y1="456" x2="345" y2="462"/><line x1="370" y1="456" x2="370" y2="462"/>
	</g>

	<!-- ===== SIDE DOORS (first pair, visible at edges) ===== -->
	<!-- Left door -->
	<rect x="72" y="200" width="14" height="250" rx="3" stroke="currentColor" stroke-width="1" stroke-dasharray="5 2"/>
	<rect x="60" y="200" width="12" height="250" rx="3" stroke="currentColor" stroke-width="1" stroke-dasharray="5 2"/>
	<!-- Door handle/indicator -->
	<circle cx="79" cy="330" r="2" fill="currentColor" opacity="0.6"/>
	<!-- Right door -->
	<rect x="414" y="200" width="14" height="250" rx="3" stroke="currentColor" stroke-width="1" stroke-dasharray="5 2"/>
	<rect x="428" y="200" width="12" height="250" rx="3" stroke="currentColor" stroke-width="1" stroke-dasharray="5 2"/>
	<!-- Door handle/indicator -->
	<circle cx="421" cy="330" r="2" fill="currentColor" opacity="0.6"/>

	<!-- ===== ROOF DETAILS ===== -->
	<!-- AC unit / ventilation grille -->
	<rect x="210" y="48" width="80" height="10" rx="3" stroke="currentColor" stroke-width="0.75"/>
	<g stroke="currentColor" stroke-width="0.5" opacity="0.4">
		<line x1="220" y1="50" x2="220" y2="56"/><line x1="230" y1="50" x2="230" y2="56"/><line x1="240" y1="50" x2="240" y2="56"/><line x1="250" y1="50" x2="250" y2="56"/><line x1="260" y1="50" x2="260" y2="56"/><line x1="270" y1="50" x2="270" y2="56"/><line x1="280" y1="50" x2="280" y2="56"/>
	</g>

	<!-- ===== DIMENSION ANNOTATIONS ===== -->
	<!-- Width dimension (2,514 mm) — at full body width -->
	<line x1="55" y1="565" x2="445" y2="565" stroke="currentColor" stroke-width="0.75" stroke-dasharray="6 3"/>
	<line x1="55" y1="558" x2="55" y2="572" stroke="currentColor" stroke-width="0.75"/>
	<line x1="445" y1="558" x2="445" y2="572" stroke="currentColor" stroke-width="0.75"/>
	<!-- Arrowheads -->
	<polygon points="55,565 62,562 62,568" fill="currentColor"/>
	<polygon points="445,565 438,562 438,568" fill="currentColor"/>
	<text x="250" y="579" font-family="JetBrains Mono" font-size="11" fill="currentColor" text-anchor="middle">2,514 mm</text>

	<!-- Height dimension (3,490 mm) — from rail to roof -->
	<line x1="460" y1="42" x2="460" y2="537" stroke="currentColor" stroke-width="0.75" stroke-dasharray="6 3"/>
	<line x1="453" y1="42" x2="467" y2="42" stroke="currentColor" stroke-width="0.75"/>
	<line x1="453" y1="537" x2="467" y2="537" stroke="currentColor" stroke-width="0.75"/>
	<!-- Arrowheads -->
	<polygon points="460,42 457,49 463,49" fill="currentColor"/>
	<polygon points="460,537 457,530 463,530" fill="currentColor"/>
	<text x="472" y="292" font-family="JetBrains Mono" font-size="10" fill="currentColor" transform="rotate(90,472,292)" text-anchor="middle">3,490 mm</text>

	<!-- Track gauge dimension (1,435 mm) — between center rails -->
	<line x1="145" y1="550" x2="355" y2="550" stroke="currentColor" stroke-width="0.75" stroke-dasharray="6 3"/>
	<line x1="145" y1="545" x2="145" y2="555" stroke="currentColor" stroke-width="0.75"/>
	<line x1="355" y1="545" x2="355" y2="555" stroke="currentColor" stroke-width="0.75"/>
	<!-- Arrowheads -->
	<polygon points="145,550 152,547 152,553" fill="currentColor"/>
	<polygon points="355,550 348,547 348,553" fill="currentColor"/>
	<text x="250" y="560" font-family="JetBrains Mono" font-size="9" fill="currentColor" text-anchor="middle">1,435 mm</text>

	<!-- ===== CENTERLINE ===== -->
	<line x1="250" y1="35" x2="250" y2="545" stroke="currentColor" stroke-width="0.5" stroke-dasharray="20 5 2 5" opacity="0.3"/>

	<!-- ===== TITLE BLOCK ===== -->
	<g transform="translate(310,600)">
		<rect x="0" y="0" width="180" height="42" stroke="currentColor" stroke-width="1"/>
		<line x1="0" y1="14" x2="180" y2="14" stroke="currentColor" stroke-width="0.5"/>
		<line x1="0" y1="28" x2="180" y2="28" stroke="currentColor" stroke-width="0.5"/>
		<line x1="90" y1="0" x2="90" y2="42" stroke="currentColor" stroke-width="0.5"/>
		<text x="45" y="11" font-family="JetBrains Mono" font-size="8" fill="currentColor" text-anchor="middle">STM ALSTOM-BBD</text>
		<text x="135" y="11" font-family="JetBrains Mono" font-size="8" fill="currentColor" text-anchor="middle">MPM-10 AZUR</text>
		<text x="45" y="25" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">FRONT ELEVATION</text>
		<text x="135" y="25" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">SCALE ~1:24</text>
		<text x="45" y="39" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">MONTREAL QC</text>
		<text x="135" y="39" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">DWG AZUR-002-A</text>
	</g>
</svg>
