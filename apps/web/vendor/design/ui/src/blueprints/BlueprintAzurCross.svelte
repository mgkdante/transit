<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
	const uid = $props.id();
</script>

<svg class={className} {...rest} viewBox="0 0 550 700" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
	<!-- ============================================================
	     MPM-10 AZUR — CROSS SECTION
	     Scale: ~0.065 SVG units per mm
	     Car center: x=275
	     Running surface (top of rollway): y=460
	     Floor: y=382 (1200mm above running surface)
	     Roof top: y=155 (3490mm above running surface → 460 - 3490*0.065 ≈ 233, adjusted for composition)
	     Car outer left: x=275 - 2514*0.065/2 ≈ 275-82 = 193
	     Car outer right: x=275 + 82 = 357
	     ============================================================ -->

	<!-- === TITLE === -->
	<text x="275" y="28" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="14" font-weight="700" fill="currentColor" letter-spacing="3">MPM-10 · CROSS SECTION</text>
	<line x1="80" y1="36" x2="470" y2="36" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>

	<!-- === TUNNEL PROFILE (dashed arc, 7100mm diameter) === -->
	<!-- Tunnel center at x=275, y=460 (running surface). Radius = 7100*0.065/2 ≈ 231 -->
	<circle cx="275" cy="470" r="231" stroke="currentColor" stroke-width="1" stroke-dasharray="8 4" opacity="0.35"/>

	<!-- === OUTER BODY SHELL === -->
	<!-- Car body: left=193, right=357, floor=382, roof curve peak ~155 -->
	<!-- Roof is slightly arched -->
	<path d="
		M 193 382
		L 193 185
		Q 193 162, 210 155
		Q 275 138, 340 155
		Q 357 162, 357 185
		L 357 382
		Z
	" stroke="currentColor" stroke-width="2" fill="none"/>

	<!-- === CROSS-SECTION HATCHING (wall thickness ~50mm ≈ 3.25px, using 5px for visibility) === -->
	<defs>
		<clipPath id="{uid}-hatch-left">
			<rect x="193" y="155" width="5" height="227"/>
		</clipPath>
		<clipPath id="{uid}-hatch-right">
			<rect x="352" y="155" width="5" height="227"/>
		</clipPath>
		<clipPath id="{uid}-hatch-roof">
			<path d="M 193 185 Q 193 162, 210 155 Q 275 138, 340 155 Q 357 162, 357 185 L 352 185 Q 352 167, 338 160 Q 275 145, 212 160 Q 198 167, 198 185 Z"/>
		</clipPath>
		<clipPath id="{uid}-hatch-floor">
			<rect x="193" y="377" width="164" height="5"/>
		</clipPath>
		<pattern id="{uid}-hatch-pattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
			<line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-width="0.7" opacity="0.6"/>
		</pattern>
	</defs>

	<!-- Left wall hatching -->
	<rect x="188" y="150" width="12" height="232" fill="url(#{uid}-hatch-pattern)" clip-path="url(#{uid}-hatch-left)"/>
	<!-- Right wall hatching -->
	<rect x="348" y="150" width="12" height="232" fill="url(#{uid}-hatch-pattern)" clip-path="url(#{uid}-hatch-right)"/>
	<!-- Roof hatching -->
	<rect x="190" y="130" width="170" height="60" fill="url(#{uid}-hatch-pattern)" clip-path="url(#{uid}-hatch-roof)"/>
	<!-- Floor hatching -->
	<rect x="190" y="374" width="170" height="12" fill="url(#{uid}-hatch-pattern)" clip-path="url(#{uid}-hatch-floor)"/>

	<!-- Inner wall lines (showing wall thickness) -->
	<path d="
		M 198 382
		L 198 185
		Q 198 167, 212 160
		Q 275 145, 338 160
		Q 352 167, 352 185
		L 352 382
	" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2" opacity="0.5"/>

	<!-- === HVAC UNIT ON ROOF === -->
	<rect x="242" y="125" width="66" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/>
	<!-- HVAC grille lines -->
	<line x1="252" y1="128" x2="252" y2="138" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>
	<line x1="260" y1="128" x2="260" y2="138" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>
	<line x1="268" y1="128" x2="268" y2="138" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>
	<line x1="275" y1="128" x2="275" y2="138" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>
	<line x1="282" y1="128" x2="282" y2="138" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>
	<line x1="290" y1="128" x2="290" y2="138" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>
	<line x1="298" y1="128" x2="298" y2="138" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>

	<!-- === INTERIOR CEILING LINE === -->
	<path d="M 202 190 Q 275 175, 348 190" stroke="currentColor" stroke-width="0.75" opacity="0.6"/>

	<!-- === GRAB BARS / HANDRAILS (horizontal bars near ceiling) === -->
	<!-- Left horizontal grab bar -->
	<line x1="208" y1="200" x2="260" y2="200" stroke="currentColor" stroke-width="1.5"/>
	<!-- Hangers from ceiling to grab bar -->
	<line x1="215" y1="190" x2="215" y2="200" stroke="currentColor" stroke-width="0.75"/>
	<line x1="235" y1="187" x2="235" y2="200" stroke="currentColor" stroke-width="0.75"/>
	<line x1="253" y1="185" x2="253" y2="200" stroke="currentColor" stroke-width="0.75"/>

	<!-- Right horizontal grab bar -->
	<line x1="290" y1="200" x2="342" y2="200" stroke="currentColor" stroke-width="1.5"/>
	<!-- Hangers from ceiling to grab bar -->
	<line x1="297" y1="185" x2="297" y2="200" stroke="currentColor" stroke-width="0.75"/>
	<line x1="315" y1="187" x2="315" y2="200" stroke="currentColor" stroke-width="0.75"/>
	<line x1="335" y1="190" x2="335" y2="200" stroke="currentColor" stroke-width="0.75"/>

	<!-- === BENCH SEATS (longitudinal, along both walls) === -->
	<!-- Left bench seat profile -->
	<path d="M 200 375 L 200 340 L 205 335 L 225 335 L 228 340 L 228 375" stroke="currentColor" stroke-width="1.5"/>
	<!-- Seat cushion detail -->
	<line x1="205" y1="340" x2="225" y2="340" stroke="currentColor" stroke-width="0.75"/>
	<!-- Backrest -->
	<line x1="200" y1="340" x2="200" y2="310" stroke="currentColor" stroke-width="1"/>
	<path d="M 200 310 Q 202 308, 205 310" stroke="currentColor" stroke-width="0.75"/>

	<!-- Right bench seat profile -->
	<path d="M 350 375 L 350 340 L 345 335 L 325 335 L 322 340 L 322 375" stroke="currentColor" stroke-width="1.5"/>
	<!-- Seat cushion detail -->
	<line x1="325" y1="340" x2="345" y2="340" stroke="currentColor" stroke-width="0.75"/>
	<!-- Backrest -->
	<line x1="350" y1="340" x2="350" y2="310" stroke="currentColor" stroke-width="1"/>
	<path d="M 350 310 Q 348 308, 345 310" stroke="currentColor" stroke-width="0.75"/>

	<!-- === VERTICAL GRAB POLES (center aisle) === -->
	<!-- Pole 1 (left of center) -->
	<line x1="255" y1="195" x2="255" y2="375" stroke="currentColor" stroke-width="1.5"/>
	<circle cx="255" cy="195" r="2" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="255" cy="375" r="2" stroke="currentColor" stroke-width="0.75"/>

	<!-- Pole 2 (center) -->
	<line x1="275" y1="193" x2="275" y2="375" stroke="currentColor" stroke-width="1.5"/>
	<circle cx="275" cy="193" r="2" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="275" cy="375" r="2" stroke="currentColor" stroke-width="0.75"/>

	<!-- Pole 3 (right of center) -->
	<line x1="295" y1="195" x2="295" y2="375" stroke="currentColor" stroke-width="1.5"/>
	<circle cx="295" cy="195" r="2" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="295" cy="375" r="2" stroke="currentColor" stroke-width="0.75"/>

	<!-- === FLOOR STRUCTURE === -->
	<line x1="193" y1="382" x2="357" y2="382" stroke="currentColor" stroke-width="2"/>

	<!-- === UNDER-FLOOR EQUIPMENT BAY === -->
	<rect x="210" y="387" width="130" height="25" rx="2" stroke="currentColor" stroke-width="1" stroke-dasharray="4 2" opacity="0.6"/>
	<!-- Equipment bay internal divisions -->
	<line x1="253" y1="387" x2="253" y2="412" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2" opacity="0.5"/>
	<line x1="297" y1="387" x2="297" y2="412" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2" opacity="0.5"/>

	<!-- Under-floor fairing / lower body -->
	<path d="M 198 382 L 198 420 Q 198 425, 203 425 L 347 425 Q 352 425, 352 420 L 352 382" stroke="currentColor" stroke-width="1" opacity="0.7"/>

	<!-- === CONCRETE ROLLWAY (flat surface on each side) === -->
	<!-- Left rollway -->
	<rect x="160" y="458" width="50" height="8" stroke="currentColor" stroke-width="1.5"/>
	<!-- Concrete hatching -->
	<line x1="165" y1="458" x2="165" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>
	<line x1="172" y1="458" x2="172" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>
	<line x1="179" y1="458" x2="179" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>
	<line x1="186" y1="458" x2="186" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>
	<line x1="193" y1="458" x2="193" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>
	<line x1="200" y1="458" x2="200" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>
	<line x1="207" y1="458" x2="207" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>

	<!-- Right rollway -->
	<rect x="340" y="458" width="50" height="8" stroke="currentColor" stroke-width="1.5"/>
	<!-- Concrete hatching -->
	<line x1="345" y1="458" x2="345" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>
	<line x1="352" y1="458" x2="352" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>
	<line x1="359" y1="458" x2="359" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>
	<line x1="366" y1="458" x2="366" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>
	<line x1="373" y1="458" x2="373" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>
	<line x1="380" y1="458" x2="380" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>
	<line x1="387" y1="458" x2="387" y2="466" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>

	<!-- === RUBBER TIRES (on the rollways) === -->
	<!-- Left tire -->
	<ellipse cx="195" cy="452" rx="12" ry="10" stroke="currentColor" stroke-width="1.5"/>
	<ellipse cx="195" cy="452" rx="5" ry="4" stroke="currentColor" stroke-width="0.75" opacity="0.6"/>
	<!-- Tire axle stub -->
	<line x1="195" y1="442" x2="195" y2="430" stroke="currentColor" stroke-width="1.5"/>

	<!-- Right tire -->
	<ellipse cx="355" cy="452" rx="12" ry="10" stroke="currentColor" stroke-width="1.5"/>
	<ellipse cx="355" cy="452" rx="5" ry="4" stroke="currentColor" stroke-width="0.75" opacity="0.6"/>
	<!-- Tire axle stub -->
	<line x1="355" y1="442" x2="355" y2="430" stroke="currentColor" stroke-width="1.5"/>

	<!-- Axle connecting tires -->
	<line x1="195" y1="435" x2="355" y2="435" stroke="currentColor" stroke-width="1" stroke-dasharray="4 3" opacity="0.5"/>

	<!-- === GUIDE BARS (vertical, on each side) === -->
	<!-- Left guide bar -->
	<rect x="155" y="440" width="4" height="35" stroke="currentColor" stroke-width="1.5"/>

	<!-- Right guide bar -->
	<rect x="391" y="440" width="4" height="35" stroke="currentColor" stroke-width="1.5"/>

	<!-- === GUIDE WHEELS (pressing against guide bars) === -->
	<!-- Left guide wheel -->
	<circle cx="166" cy="457" r="7" stroke="currentColor" stroke-width="1.5"/>
	<circle cx="166" cy="457" r="2.5" stroke="currentColor" stroke-width="0.75"/>
	<!-- Guide wheel arm -->
	<line x1="173" y1="457" x2="195" y2="445" stroke="currentColor" stroke-width="1"/>

	<!-- Right guide wheel -->
	<circle cx="384" cy="457" r="7" stroke="currentColor" stroke-width="1.5"/>
	<circle cx="384" cy="457" r="2.5" stroke="currentColor" stroke-width="0.75"/>
	<!-- Guide wheel arm -->
	<line x1="377" y1="457" x2="355" y2="445" stroke="currentColor" stroke-width="1"/>

	<!-- === STEEL RAILS (center) === -->
	<!-- Left rail (I-beam profile) -->
	<path d="M 258 477 L 258 467 M 254 467 L 262 467 M 254 477 L 262 477" stroke="currentColor" stroke-width="1.5"/>
	<!-- Rail web -->
	<line x1="258" y1="467" x2="258" y2="477" stroke="currentColor" stroke-width="1"/>

	<!-- Right rail (I-beam profile) -->
	<path d="M 292 477 L 292 467 M 288 467 L 296 467 M 288 477 L 296 477" stroke="currentColor" stroke-width="1.5"/>
	<!-- Rail web -->
	<line x1="292" y1="467" x2="292" y2="477" stroke="currentColor" stroke-width="1"/>

	<!-- === SAFETY WHEELS (above the rails) === -->
	<!-- Left safety wheel -->
	<circle cx="258" cy="462" r="5" stroke="currentColor" stroke-width="1"/>
	<circle cx="258" cy="462" r="1.5" fill="currentColor"/>
	<!-- Safety wheel arm -->
	<line x1="258" y1="457" x2="258" y2="445" stroke="currentColor" stroke-width="0.75" stroke-dasharray="2 1"/>

	<!-- Right safety wheel -->
	<circle cx="292" cy="462" r="5" stroke="currentColor" stroke-width="1"/>
	<circle cx="292" cy="462" r="1.5" fill="currentColor"/>
	<!-- Safety wheel arm -->
	<line x1="292" y1="457" x2="292" y2="445" stroke="currentColor" stroke-width="0.75" stroke-dasharray="2 1"/>

	<!-- === GROUND / INVERT STRUCTURE === -->
	<line x1="120" y1="485" x2="430" y2="485" stroke="currentColor" stroke-width="1" opacity="0.4"/>
	<!-- Ground cross-hatching -->
	<g stroke="currentColor" stroke-width="0.5" opacity="0.25">
		<line x1="130" y1="485" x2="125" y2="495"/><line x1="145" y1="485" x2="140" y2="495"/>
		<line x1="160" y1="485" x2="155" y2="495"/><line x1="175" y1="485" x2="170" y2="495"/>
		<line x1="190" y1="485" x2="185" y2="495"/><line x1="205" y1="485" x2="200" y2="495"/>
		<line x1="220" y1="485" x2="215" y2="495"/><line x1="235" y1="485" x2="230" y2="495"/>
		<line x1="250" y1="485" x2="245" y2="495"/><line x1="265" y1="485" x2="260" y2="495"/>
		<line x1="280" y1="485" x2="275" y2="495"/><line x1="295" y1="485" x2="290" y2="495"/>
		<line x1="310" y1="485" x2="305" y2="495"/><line x1="325" y1="485" x2="320" y2="495"/>
		<line x1="340" y1="485" x2="335" y2="495"/><line x1="355" y1="485" x2="350" y2="495"/>
		<line x1="370" y1="485" x2="365" y2="495"/><line x1="385" y1="485" x2="380" y2="495"/>
		<line x1="400" y1="485" x2="395" y2="495"/><line x1="415" y1="485" x2="410" y2="495"/>
	</g>

	<!-- ============================================================
	     DIMENSION ANNOTATIONS
	     ============================================================ -->

	<!-- Car Width: 2,514 mm (horizontal, below car body) -->
	<line x1="193" y1="400" x2="193" y2="510" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.4"/>
	<line x1="357" y1="400" x2="357" y2="510" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.4"/>
	<line x1="193" y1="505" x2="357" y2="505" stroke="currentColor" stroke-width="0.75"/>
	<!-- Arrowheads -->
	<polygon points="193,505 199,503 199,507" fill="currentColor"/>
	<polygon points="357,505 351,503 351,507" fill="currentColor"/>
	<text x="275" y="518" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="7" fill="currentColor">2,514 mm</text>

	<!-- Car Height: 3,490 mm (vertical, right side) -->
	<line x1="360" y1="143" x2="410" y2="143" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.4"/>
	<line x1="365" y1="460" x2="410" y2="460" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.4"/>
	<line x1="405" y1="143" x2="405" y2="460" stroke="currentColor" stroke-width="0.75"/>
	<!-- Arrowheads -->
	<polygon points="405,143 403,149 407,149" fill="currentColor"/>
	<polygon points="405,460 403,454 407,454" fill="currentColor"/>
	<text x="410" y="305" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="7" fill="currentColor" transform="rotate(90,410,305)" text-anchor="middle">3,490 mm</text>

	<!-- Floor Height: 1,200 mm (vertical, left side) -->
	<line x1="140" y1="382" x2="190" y2="382" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.4"/>
	<line x1="140" y1="460" x2="165" y2="460" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.4"/>
	<line x1="145" y1="382" x2="145" y2="460" stroke="currentColor" stroke-width="0.75"/>
	<!-- Arrowheads -->
	<polygon points="145,382 143,388 147,388" fill="currentColor"/>
	<polygon points="145,460 143,454 147,454" fill="currentColor"/>
	<text x="140" y="425" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="6.5" fill="currentColor" transform="rotate(-90,140,425)" text-anchor="middle">1,200 mm</text>

	<!-- Interior Width: ~2,414 mm (horizontal, inside car) -->
	<line x1="198" y1="360" x2="352" y2="360" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2" opacity="0.5"/>
	<polygon points="198,360 204,358 204,362" fill="currentColor" opacity="0.6"/>
	<polygon points="352,360 346,358 346,362" fill="currentColor" opacity="0.6"/>
	<text x="275" y="357" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="5.5" fill="currentColor" opacity="0.7">~2,414 mm</text>

	<!-- Aisle Width (between seats) -->
	<line x1="228" y1="350" x2="322" y2="350" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 1.5" opacity="0.5"/>
	<polygon points="228,350 233,348.5 233,351.5" fill="currentColor" opacity="0.5"/>
	<polygon points="322,350 317,348.5 317,351.5" fill="currentColor" opacity="0.5"/>
	<text x="275" y="347" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="5" fill="currentColor" opacity="0.6">AISLE ~1,450 mm</text>

	<!-- Tunnel Diameter: 7,100 mm (diagonal annotation) -->
	<!-- Dimension line along the tunnel arc -->
	<line x1="275" y1="239" x2="440" y2="350" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2" opacity="0.4"/>
	<text x="445" y="348" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="6.5" fill="currentColor" opacity="0.6">&#x2300; 7,100 mm</text>

	<!-- ============================================================
	     LABELS
	     ============================================================ -->

	<!-- HVAC label -->
	<line x1="275" y1="125" x2="275" y2="108" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<line x1="275" y1="108" x2="310" y2="108" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<text x="313" y="111" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="7" fill="currentColor" font-weight="600">HVAC</text>

	<!-- GRAB BAR label -->
	<line x1="345" y1="200" x2="370" y2="200" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<line x1="370" y1="200" x2="388" y2="190" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<text x="391" y="193" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="6.5" fill="currentColor" font-weight="600">GRAB BAR</text>

	<!-- BENCH SEAT label (left) -->
	<line x1="200" y1="330" x2="180" y2="315" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<line x1="180" y1="315" x2="100" y2="315" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<text x="97" y="313" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="6.5" fill="currentColor" font-weight="600" text-anchor="end">BENCH SEAT</text>

	<!-- BENCH SEAT label (right) -->
	<line x1="350" y1="330" x2="370" y2="315" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<line x1="370" y1="315" x2="440" y2="315" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<text x="443" y="313" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="6.5" fill="currentColor" font-weight="600">BENCH SEAT</text>

	<!-- FLOOR label -->
	<line x1="357" y1="382" x2="380" y2="382" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<line x1="380" y1="382" x2="395" y2="375" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<text x="398" y="378" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="6.5" fill="currentColor" font-weight="600">FLOOR</text>

	<!-- ROLLWAY label (left) -->
	<line x1="168" y1="466" x2="130" y2="480" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<text x="97" y="483" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="6.5" fill="currentColor" font-weight="600" text-anchor="end">ROLLWAY</text>

	<!-- ROLLWAY label (right) -->
	<line x1="382" y1="466" x2="420" y2="480" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<text x="423" y="483" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="6.5" fill="currentColor" font-weight="600">ROLLWAY</text>

	<!-- GUIDE BAR label (left) -->
	<line x1="155" y1="445" x2="115" y2="435" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<text x="112" y="433" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="6.5" fill="currentColor" font-weight="600" text-anchor="end">GUIDE BAR</text>

	<!-- GUIDE BAR label (right) -->
	<line x1="395" y1="445" x2="435" y2="435" stroke="currentColor" stroke-width="0.5" opacity="0.6"/>
	<text x="438" y="433" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="6.5" fill="currentColor" font-weight="600">GUIDE BAR</text>

	<!-- SAFETY WHEEL label -->
	<line x1="258" y1="455" x2="258" y2="530" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.4"/>
	<text x="275" y="540" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="5.5" fill="currentColor" opacity="0.6">SAFETY WHEELS</text>

	<!-- STEEL RAIL label -->
	<text x="275" y="552" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="5.5" fill="currentColor" opacity="0.6">STEEL RAILS</text>

	<!-- RUBBER TIRE label (left) -->
	<text x="195" y="440" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="5" fill="currentColor" opacity="0.55">TIRE</text>

	<!-- RUBBER TIRE label (right) -->
	<text x="355" y="440" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="5" fill="currentColor" opacity="0.55">TIRE</text>

	<!-- GUIDE WHEEL label (left) -->
	<text x="166" y="472" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="4.5" fill="currentColor" opacity="0.5">GUIDE WHL</text>

	<!-- GUIDE WHEEL label (right) -->
	<text x="384" y="472" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="4.5" fill="currentColor" opacity="0.5">GUIDE WHL</text>

	<!-- === STANDING FIGURES (ghosted silhouettes to show scale) === -->
	<!-- Center figure -->
	<g opacity="0.2" stroke="currentColor" fill="none">
		<circle cx="275" cy="240" r="6" stroke-width="0.75"/>
		<line x1="275" y1="246" x2="275" y2="310" stroke-width="0.75"/>
		<line x1="275" y1="260" x2="265" y2="280" stroke-width="0.75"/>
		<line x1="275" y1="260" x2="285" y2="280" stroke-width="0.75"/>
		<line x1="275" y1="310" x2="268" y2="370" stroke-width="0.75"/>
		<line x1="275" y1="310" x2="282" y2="370" stroke-width="0.75"/>
	</g>

	<!-- === CENTERLINE === -->
	<line x1="275" y1="50" x2="275" y2="495" stroke="currentColor" stroke-width="0.3" stroke-dasharray="1 4" opacity="0.2"/>
	<!-- CL symbol -->
	<text x="275" y="565" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="5" fill="currentColor" opacity="0.3">CL</text>

	<!-- === DRAWING INFO BLOCK === -->
	<line x1="80" y1="580" x2="470" y2="580" stroke="currentColor" stroke-width="0.5" opacity="0.3"/>
	<text x="275" y="596" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="5.5" fill="currentColor" opacity="0.4">MONTREAL METRO · RUBBER-TIRED SYSTEM</text>
	<text x="275" y="608" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="5" fill="currentColor" opacity="0.35">ALSTOM / BOMBARDIER · MPM-10 AZUR (2014)</text>
	<text x="275" y="620" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="4.5" fill="currentColor" opacity="0.3">CROSS-SECTION PERPENDICULAR TO TRACK AXIS</text>
	<text x="275" y="632" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="4" fill="currentColor" opacity="0.25">NOT TO SCALE · FOR REFERENCE ONLY</text>

	<!-- === REVISION BLOCK (bottom right) === -->
	<rect x="390" y="648" width="80" height="28" stroke="currentColor" stroke-width="0.5" opacity="0.3"/>
	<text x="430" y="660" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="4" fill="currentColor" opacity="0.3">DWG NO. YSD-CS-001</text>
	<text x="430" y="670" text-anchor="middle" font-family="'JetBrains Mono', 'Courier New', monospace" font-size="4" fill="currentColor" opacity="0.3">REV A</text>

	<!-- === BORDER FRAME === -->
	<rect x="60" y="10" width="430" height="680" stroke="currentColor" stroke-width="0.5" opacity="0.15" rx="2"/>
</svg>
