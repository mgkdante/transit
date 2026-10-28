<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 600 500" fill="none" xmlns="http://www.w3.org/2000/svg">
	<!-- Title -->
	<text x="300" y="24" font-family="monospace" font-size="12" fill="currentColor" text-anchor="middle" font-weight="bold">BOGIE · ALSTOM CL 449</text>
	<text x="300" y="38" font-family="monospace" font-size="10" fill="currentColor" text-anchor="middle">MPM-10 AZUR · RUBBER-TIRE BOGIE SYSTEM (SIDE VIEW)</text>
	<line x1="40" y1="46" x2="560" y2="46" stroke="currentColor" stroke-width="0.5"/>

	<!-- ======================== -->
	<!-- CONCRETE ROLLWAY SURFACE -->
	<!-- ======================== -->
	<!-- Main rollway surface (flat, not curved) -->
	<rect x="30" y="380" width="540" height="12" stroke="currentColor" stroke-width="1.5" rx="1"/>
	<!-- Rollway surface texture lines -->
	<line x1="50" y1="386" x2="80" y2="386" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 3"/>
	<line x1="100" y1="386" x2="145" y2="386" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 3"/>
	<line x1="165" y1="386" x2="210" y2="386" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 3"/>
	<line x1="230" y1="386" x2="275" y2="386" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 3"/>
	<line x1="325" y1="386" x2="370" y2="386" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 3"/>
	<line x1="390" y1="386" x2="435" y2="386" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 3"/>
	<line x1="455" y1="386" x2="500" y2="386" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 3"/>
	<line x1="520" y1="386" x2="555" y2="386" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 3"/>
	<!-- CONCRETE ROLLWAY label -->
	<text x="460" y="408" font-family="monospace" font-size="10" fill="currentColor" text-anchor="middle">CONCRETE ROLLWAY</text>

	<!-- ========== -->
	<!-- STEEL RAIL -->
	<!-- ========== -->
	<!-- Steel rail cross-section (between the rollways, centered) -->
	<rect x="285" y="370" width="30" height="10" stroke="currentColor" stroke-width="1.5" rx="0"/>
	<!-- Rail head (T-profile top) -->
	<rect x="289" y="364" width="22" height="6" stroke="currentColor" stroke-width="1" rx="1"/>
	<!-- Rail web -->
	<rect x="296" y="370" width="8" height="10" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 1"/>
	<!-- STEEL RAIL label -->
	<line x1="300" y1="395" x2="300" y2="418" stroke="currentColor" stroke-width="0.5"/>
	<text x="300" y="430" font-family="monospace" font-size="10" fill="currentColor" text-anchor="middle">STEEL RAIL</text>

	<!-- =========================== -->
	<!-- LEFT RUNNING WHEEL (RUBBER) -->
	<!-- =========================== -->
	<!-- Large pneumatic rubber tire - ~65px radius representing 800mm diameter -->
	<!-- Outer tire -->
	<circle cx="160" cy="318" r="60" stroke="currentColor" stroke-width="2"/>
	<!-- Rubber tread band (thick outer ring) -->
	<circle cx="160" cy="318" r="53" stroke="currentColor" stroke-width="1"/>
	<!-- Tread pattern segments -->
	<path d="M160 258 v8 M160 370 v8" stroke="currentColor" stroke-width="1"/>
	<path d="M100 318 h8 M212 318 h8" stroke="currentColor" stroke-width="1"/>
	<path d="M118 276 l5.6 5.6 M196 354 l5.6 5.6" stroke="currentColor" stroke-width="0.75"/>
	<path d="M196 276 l-5.6 5.6 M118 354 l-5.6 5.6" stroke="currentColor" stroke-width="0.75"/>
	<!-- Inner rim -->
	<circle cx="160" cy="318" r="28" stroke="currentColor" stroke-width="1"/>
	<!-- Hub -->
	<circle cx="160" cy="318" r="12" stroke="currentColor" stroke-width="1.5"/>
	<!-- Axle center -->
	<circle cx="160" cy="318" r="4" fill="currentColor"/>
	<!-- Tread texture arcs (rubber pattern) -->
	<path d="M117 288 a60 60 0 0 1 14 -14" stroke="currentColor" stroke-width="0.5"/>
	<path d="M189 262 a60 60 0 0 1 14 14" stroke="currentColor" stroke-width="0.5"/>
	<path d="M203 348 a60 60 0 0 1 -14 14" stroke="currentColor" stroke-width="0.5"/>
	<path d="M131 374 a60 60 0 0 1 -14 -14" stroke="currentColor" stroke-width="0.5"/>
	<!-- Running wheel label -->
	<line x1="160" y1="258" x2="160" y2="232" stroke="currentColor" stroke-width="0.5"/>
	<text x="160" y="224" font-family="monospace" font-size="10" fill="currentColor" text-anchor="middle">RUNNING WHEEL</text>
	<text x="160" y="236" font-family="monospace" font-size="10" fill="currentColor" text-anchor="middle">(RUBBER)</text>

	<!-- ============================ -->
	<!-- RIGHT RUNNING WHEEL (RUBBER) -->
	<!-- ============================ -->
	<!-- Large pneumatic rubber tire -->
	<circle cx="440" cy="318" r="60" stroke="currentColor" stroke-width="2"/>
	<circle cx="440" cy="318" r="53" stroke="currentColor" stroke-width="1"/>
	<!-- Tread pattern -->
	<path d="M440 258 v8 M440 370 v8" stroke="currentColor" stroke-width="1"/>
	<path d="M380 318 h8 M492 318 h8" stroke="currentColor" stroke-width="1"/>
	<path d="M398 276 l5.6 5.6 M476 354 l5.6 5.6" stroke="currentColor" stroke-width="0.75"/>
	<path d="M476 276 l-5.6 5.6 M398 354 l-5.6 5.6" stroke="currentColor" stroke-width="0.75"/>
	<!-- Inner rim -->
	<circle cx="440" cy="318" r="28" stroke="currentColor" stroke-width="1"/>
	<!-- Hub -->
	<circle cx="440" cy="318" r="12" stroke="currentColor" stroke-width="1.5"/>
	<!-- Axle center -->
	<circle cx="440" cy="318" r="4" fill="currentColor"/>
	<!-- Tread texture arcs -->
	<path d="M397 288 a60 60 0 0 1 14 -14" stroke="currentColor" stroke-width="0.5"/>
	<path d="M469 262 a60 60 0 0 1 14 14" stroke="currentColor" stroke-width="0.5"/>
	<path d="M483 348 a60 60 0 0 1 -14 14" stroke="currentColor" stroke-width="0.5"/>
	<path d="M411 374 a60 60 0 0 1 -14 -14" stroke="currentColor" stroke-width="0.5"/>

	<!-- =========== -->
	<!-- BOGIE FRAME -->
	<!-- =========== -->
	<!-- Main horizontal beam -->
	<rect x="110" y="270" width="380" height="30" rx="4" stroke="currentColor" stroke-width="1.5"/>
	<!-- Internal structure lines -->
	<line x1="130" y1="275" x2="130" y2="295" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<line x1="470" y1="275" x2="470" y2="295" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<!-- Cross-bracing (internal, dashed) -->
	<line x1="200" y1="275" x2="400" y2="295" stroke="currentColor" stroke-width="0.5" stroke-dasharray="4 3"/>
	<line x1="200" y1="295" x2="400" y2="275" stroke="currentColor" stroke-width="0.5" stroke-dasharray="4 3"/>
	<!-- Vertical struts to axles -->
	<line x1="145" y1="300" x2="145" y2="318" stroke="currentColor" stroke-width="1"/>
	<line x1="175" y1="300" x2="175" y2="318" stroke="currentColor" stroke-width="1"/>
	<line x1="425" y1="300" x2="425" y2="318" stroke="currentColor" stroke-width="1"/>
	<line x1="455" y1="300" x2="455" y2="318" stroke="currentColor" stroke-width="1"/>
	<!-- Axle lines through wheels -->
	<line x1="100" y1="318" x2="220" y2="318" stroke="currentColor" stroke-width="0.75" stroke-dasharray="5 3"/>
	<line x1="380" y1="318" x2="500" y2="318" stroke="currentColor" stroke-width="0.75" stroke-dasharray="5 3"/>

	<!-- ============== -->
	<!-- TRACTION MOTOR -->
	<!-- ============== -->
	<!-- Motor housing (rectangular box on left axle) -->
	<rect x="125" y="290" width="70" height="24" rx="3" stroke="currentColor" stroke-width="1.5"/>
	<!-- Motor internal detail -->
	<line x1="140" y1="294" x2="140" y2="310" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2"/>
	<line x1="155" y1="294" x2="155" y2="310" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2"/>
	<line x1="170" y1="294" x2="170" y2="310" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2"/>
	<line x1="185" y1="294" x2="185" y2="310" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2"/>
	<!-- Motor shaft connection -->
	<line x1="160" y1="314" x2="160" y2="318" stroke="currentColor" stroke-width="1"/>
	<!-- Motor label -->
	<line x1="160" y1="290" x2="160" y2="262" stroke="currentColor" stroke-width="0.5"/>
	<line x1="160" y1="262" x2="82" y2="262" stroke="currentColor" stroke-width="0.5"/>
	<text x="80" y="259" font-family="monospace" font-size="10" fill="currentColor" text-anchor="end">TRACTION MOTOR</text>

	<!-- ======================================= -->
	<!-- SECONDARY SUSPENSION (bolster springs)  -->
	<!-- ======================================= -->
	<!-- Left spring set -->
	<path d="M240 270 v-8 l8 -6 l-16 -6 l16 -6 l-16 -6 l16 -6 l-16 -6 l8 -6 v-8" stroke="currentColor" stroke-width="1" fill="none"/>
	<!-- Right spring set -->
	<path d="M360 270 v-8 l8 -6 l-16 -6 l16 -6 l-16 -6 l16 -6 l-16 -6 l8 -6 v-8" stroke="currentColor" stroke-width="1" fill="none"/>
	<!-- Secondary suspension top plate (bolster) -->
	<rect x="225" y="198" width="150" height="14" rx="2" stroke="currentColor" stroke-width="1"/>
	<!-- Bolster pivot -->
	<circle cx="300" cy="205" r="5" stroke="currentColor" stroke-width="1"/>
	<circle cx="300" cy="205" r="2" fill="currentColor"/>

	<!-- ======================================= -->
	<!-- PRIMARY SUSPENSION (above each axle)    -->
	<!-- ======================================= -->
	<!-- Left primary spring -->
	<path d="M150 270 v-5 l5 -4 l-10 -4 l10 -4 l-10 -4 l5 -4 v-5" stroke="currentColor" stroke-width="0.75" fill="none"/>
	<!-- Right primary spring -->
	<path d="M170 270 v-5 l5 -4 l-10 -4 l10 -4 l-10 -4 l5 -4 v-5" stroke="currentColor" stroke-width="0.75" fill="none"/>
	<!-- Left primary spring far -->
	<path d="M430 270 v-5 l5 -4 l-10 -4 l10 -4 l-10 -4 l5 -4 v-5" stroke="currentColor" stroke-width="0.75" fill="none"/>
	<!-- Right primary spring far -->
	<path d="M450 270 v-5 l5 -4 l-10 -4 l10 -4 l-10 -4 l5 -4 v-5" stroke="currentColor" stroke-width="0.75" fill="none"/>
	<!-- Suspension labels -->
	<text x="300" y="194" font-family="monospace" font-size="8" fill="currentColor" text-anchor="middle">SECONDARY SUSPENSION</text>
	<text x="160" y="238" font-family="monospace" font-size="7" fill="currentColor" text-anchor="middle">PRIMARY</text>
	<text x="440" y="238" font-family="monospace" font-size="7" fill="currentColor" text-anchor="middle">PRIMARY</text>

	<!-- ============================================== -->
	<!-- SAFETY WHEELS (STEEL, FLANGED) — between tires -->
	<!-- ============================================== -->
	<!-- Left safety wheel — smaller, steel, with flange -->
	<circle cx="280" cy="356" r="16" stroke="currentColor" stroke-width="1.5"/>
	<circle cx="280" cy="356" r="8" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="280" cy="356" r="3" fill="currentColor"/>
	<!-- Flange detail (below wheel, extending down) -->
	<path d="M266 362 l-3 8 l34 0 l-3 -8" stroke="currentColor" stroke-width="0.75"/>
	<!-- Flange lip -->
	<line x1="263" y1="370" x2="261" y2="364" stroke="currentColor" stroke-width="1"/>
	<!-- Safety wheel clearance indicator (2-3mm gap above rail) -->
	<line x1="270" y1="372" x2="290" y2="372" stroke="currentColor" stroke-width="0.5" stroke-dasharray="1 2"/>
	<!-- Clearance dimension -->
	<line x1="300" y1="364" x2="300" y2="372" stroke="currentColor" stroke-width="0.5"/>
	<text x="310" y="365" font-family="monospace" font-size="7" fill="currentColor">2-3mm</text>
	<text x="310" y="373" font-family="monospace" font-size="7" fill="currentColor">CLEARANCE</text>
	<!-- Safety wheel mounting arm from bogie frame -->
	<line x1="280" y1="300" x2="280" y2="340" stroke="currentColor" stroke-width="1"/>
	<!-- Right safety wheel -->
	<circle cx="320" cy="356" r="16" stroke="currentColor" stroke-width="1.5"/>
	<circle cx="320" cy="356" r="8" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="320" cy="356" r="3" fill="currentColor"/>
	<!-- Right flange -->
	<path d="M306 362 l-3 8 l34 0 l-3 -8" stroke="currentColor" stroke-width="0.75"/>
	<line x1="337" y1="370" x2="339" y2="364" stroke="currentColor" stroke-width="1"/>
	<!-- Right mounting arm -->
	<line x1="320" y1="300" x2="320" y2="340" stroke="currentColor" stroke-width="1"/>
	<!-- Safety wheel label -->
	<line x1="300" y1="356" x2="300" y2="340" stroke="currentColor" stroke-width="0.5"/>
	<line x1="300" y1="340" x2="370" y2="340" stroke="currentColor" stroke-width="0.5"/>
	<text x="372" y="337" font-family="monospace" font-size="10" fill="currentColor">SAFETY WHEEL</text>
	<text x="372" y="349" font-family="monospace" font-size="10" fill="currentColor">(STEEL)</text>

	<!-- ============ -->
	<!-- GUIDE WHEELS -->
	<!-- ============ -->
	<!-- Left guide bar (vertical steel bar) -->
	<rect x="48" y="260" width="8" height="115" stroke="currentColor" stroke-width="1.5" rx="1"/>
	<!-- Left guide bar power indicator -->
	<line x1="52" y1="268" x2="52" y2="280" stroke="currentColor" stroke-width="0.5" stroke-dasharray="1 2"/>
	<!-- Left guide wheel (horizontal orientation, pressing against bar) -->
	<ellipse cx="68" cy="300" rx="12" ry="16" stroke="currentColor" stroke-width="1.5"/>
	<ellipse cx="68" cy="300" rx="5" ry="7" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="68" cy="300" r="2.5" fill="currentColor"/>
	<!-- Guide wheel mounting bracket -->
	<line x1="80" y1="300" x2="110" y2="285" stroke="currentColor" stroke-width="1"/>
	<!-- Second left guide wheel (lower) -->
	<ellipse cx="68" cy="340" rx="12" ry="16" stroke="currentColor" stroke-width="1.5"/>
	<ellipse cx="68" cy="340" rx="5" ry="7" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="68" cy="340" r="2.5" fill="currentColor"/>
	<line x1="80" y1="340" x2="110" y2="295" stroke="currentColor" stroke-width="1"/>

	<!-- Right guide bar -->
	<rect x="544" y="260" width="8" height="115" stroke="currentColor" stroke-width="1.5" rx="1"/>
	<line x1="548" y1="268" x2="548" y2="280" stroke="currentColor" stroke-width="0.5" stroke-dasharray="1 2"/>
	<!-- Right guide wheel -->
	<ellipse cx="532" cy="300" rx="12" ry="16" stroke="currentColor" stroke-width="1.5"/>
	<ellipse cx="532" cy="300" rx="5" ry="7" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="532" cy="300" r="2.5" fill="currentColor"/>
	<line x1="520" y1="300" x2="490" y2="285" stroke="currentColor" stroke-width="1"/>
	<!-- Second right guide wheel -->
	<ellipse cx="532" cy="340" rx="12" ry="16" stroke="currentColor" stroke-width="1.5"/>
	<ellipse cx="532" cy="340" rx="5" ry="7" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="532" cy="340" r="2.5" fill="currentColor"/>
	<line x1="520" y1="340" x2="490" y2="295" stroke="currentColor" stroke-width="1"/>

	<!-- Guide wheel label (left) -->
	<line x1="52" y1="260" x2="52" y2="242" stroke="currentColor" stroke-width="0.5"/>
	<text x="52" y="238" font-family="monospace" font-size="10" fill="currentColor" text-anchor="middle">GUIDE WHEEL</text>

	<!-- Guide bar label (right) -->
	<line x1="548" y1="260" x2="548" y2="242" stroke="currentColor" stroke-width="0.5"/>
	<text x="548" y="232" font-family="monospace" font-size="10" fill="currentColor" text-anchor="middle">GUIDE BAR</text>
	<text x="548" y="244" font-family="monospace" font-size="10" fill="currentColor" text-anchor="middle">(750V DC)</text>

	<!-- ===================== -->
	<!-- POWER COLLECTION SHOE -->
	<!-- ===================== -->
	<!-- Current collector shoe on left guide bar -->
	<rect x="38" y="325" width="10" height="20" rx="2" stroke="currentColor" stroke-width="1"/>
	<!-- Contact surface -->
	<line x1="48" y1="330" x2="48" y2="340" stroke="currentColor" stroke-width="1.5"/>
	<!-- Power cable from shoe -->
	<path d="M38 335 l-10 -5 l0 -20 l20 0" stroke="currentColor" stroke-width="0.75" stroke-dasharray="3 2"/>
	<!-- Electrical symbol (lightning) -->
	<path d="M30 320 l4 -8 l-2 0 l4 -8" stroke="currentColor" stroke-width="0.75"/>
	<!-- Shoe label -->
	<text x="28" y="360" font-family="monospace" font-size="7" fill="currentColor" text-anchor="middle">POWER</text>
	<text x="28" y="368" font-family="monospace" font-size="7" fill="currentColor" text-anchor="middle">SHOE</text>

	<!-- ===================== -->
	<!-- DIMENSION ANNOTATIONS -->
	<!-- ===================== -->
	<!-- 2,000 mm wheelbase dimension line -->
	<line x1="160" y1="445" x2="160" y2="460" stroke="currentColor" stroke-width="0.5"/>
	<line x1="440" y1="445" x2="440" y2="460" stroke="currentColor" stroke-width="0.5"/>
	<line x1="160" y1="455" x2="440" y2="455" stroke="currentColor" stroke-width="0.75"/>
	<!-- Arrowheads -->
	<path d="M160 455 l8 -3 l0 6 z" fill="currentColor"/>
	<path d="M440 455 l-8 -3 l0 6 z" fill="currentColor"/>
	<text x="300" y="468" font-family="monospace" font-size="11" fill="currentColor" text-anchor="middle" font-weight="bold">2,000 mm WHEELBASE</text>

	<!-- Tire diameter annotation (left wheel) -->
	<line x1="95" y1="318" x2="85" y2="318" stroke="currentColor" stroke-width="0.5"/>
	<line x1="85" y1="258" x2="85" y2="378" stroke="currentColor" stroke-width="0.5"/>
	<line x1="95" y1="258" x2="85" y2="258" stroke="currentColor" stroke-width="0.5"/>
	<line x1="95" y1="378" x2="85" y2="378" stroke="currentColor" stroke-width="0.5"/>
	<!-- Arrowheads vertical -->
	<path d="M85 258 l-3 8 l6 0 z" fill="currentColor"/>
	<path d="M85 378 l-3 -8 l6 0 z" fill="currentColor"/>
	<text x="82" y="322" font-family="monospace" font-size="8" fill="currentColor" text-anchor="end" transform="rotate(-90 82 322)">800mm DIA</text>

	<!-- =================== -->
	<!-- BODY MOUNT (top)    -->
	<!-- =================== -->
	<!-- Car body connection plate -->
	<rect x="200" y="170" width="200" height="14" rx="2" stroke="currentColor" stroke-width="1" stroke-dasharray="5 3"/>
	<!-- Body mount label -->
	<text x="300" y="168" font-family="monospace" font-size="8" fill="currentColor" text-anchor="middle">CAR BODY INTERFACE</text>

	<!-- =================== -->
	<!-- GROUND LINE         -->
	<!-- =================== -->
	<!-- Hatch pattern below rollway to indicate ground -->
	<line x1="30" y1="392" x2="40" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="50" y1="392" x2="60" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="70" y1="392" x2="80" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="90" y1="392" x2="100" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="110" y1="392" x2="120" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="130" y1="392" x2="140" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="150" y1="392" x2="160" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="170" y1="392" x2="180" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="190" y1="392" x2="200" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="210" y1="392" x2="220" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="230" y1="392" x2="240" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="250" y1="392" x2="260" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="270" y1="392" x2="280" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="330" y1="392" x2="340" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="350" y1="392" x2="360" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="370" y1="392" x2="380" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="390" y1="392" x2="400" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="410" y1="392" x2="420" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="430" y1="392" x2="440" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="450" y1="392" x2="460" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="470" y1="392" x2="480" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="490" y1="392" x2="500" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="510" y1="392" x2="520" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="530" y1="392" x2="540" y2="400" stroke="currentColor" stroke-width="0.5"/>
	<line x1="550" y1="392" x2="560" y2="400" stroke="currentColor" stroke-width="0.5"/>

	<!-- ============== -->
	<!-- LEGEND / NOTES -->
	<!-- ============== -->
	<line x1="40" y1="480" x2="560" y2="480" stroke="currentColor" stroke-width="0.5"/>
	<!-- Solid line legend -->
	<line x1="50" y1="492" x2="75" y2="492" stroke="currentColor" stroke-width="1"/>
	<text x="80" y="495" font-family="monospace" font-size="8" fill="currentColor">VISIBLE EDGE</text>
	<!-- Dashed line legend -->
	<line x1="200" y1="492" x2="225" y2="492" stroke="currentColor" stroke-width="1" stroke-dasharray="4 2"/>
	<text x="230" y="495" font-family="monospace" font-size="8" fill="currentColor">HIDDEN / INTERNAL</text>
	<!-- Scale note -->
	<text x="560" y="495" font-family="monospace" font-size="8" fill="currentColor" text-anchor="end">SCALE: NOT TO SCALE</text>
</svg>
