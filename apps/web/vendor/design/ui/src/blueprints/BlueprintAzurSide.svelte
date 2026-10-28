<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 1800 700" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
	<!-- ========== GROUND LINE ========== -->
	<line x1="20" y1="540" x2="1780" y2="540" stroke="currentColor" stroke-width="2"/>
	<line x1="20" y1="545" x2="1780" y2="545" stroke="currentColor" stroke-width="0.5"/>
	<g stroke="currentColor" stroke-width="1" opacity="0.5">
		<line x1="60" y1="540" x2="60" y2="555"/><line x1="120" y1="540" x2="120" y2="555"/><line x1="180" y1="540" x2="180" y2="555"/><line x1="240" y1="540" x2="240" y2="555"/><line x1="300" y1="540" x2="300" y2="555"/><line x1="360" y1="540" x2="360" y2="555"/><line x1="420" y1="540" x2="420" y2="555"/><line x1="480" y1="540" x2="480" y2="555"/><line x1="540" y1="540" x2="540" y2="555"/><line x1="600" y1="540" x2="600" y2="555"/><line x1="660" y1="540" x2="660" y2="555"/><line x1="720" y1="540" x2="720" y2="555"/><line x1="780" y1="540" x2="780" y2="555"/><line x1="840" y1="540" x2="840" y2="555"/><line x1="900" y1="540" x2="900" y2="555"/><line x1="960" y1="540" x2="960" y2="555"/><line x1="1020" y1="540" x2="1020" y2="555"/><line x1="1080" y1="540" x2="1080" y2="555"/><line x1="1140" y1="540" x2="1140" y2="555"/><line x1="1200" y1="540" x2="1200" y2="555"/><line x1="1260" y1="540" x2="1260" y2="555"/><line x1="1320" y1="540" x2="1320" y2="555"/><line x1="1380" y1="540" x2="1380" y2="555"/><line x1="1440" y1="540" x2="1440" y2="555"/><line x1="1500" y1="540" x2="1500" y2="555"/><line x1="1560" y1="540" x2="1560" y2="555"/><line x1="1620" y1="540" x2="1620" y2="555"/><line x1="1680" y1="540" x2="1680" y2="555"/><line x1="1740" y1="540" x2="1740" y2="555"/>
	</g>

	<!-- ========== CAR BODY ========== -->
	<!-- Main body shell — aerodynamic curved front (left), gangway flat rear (right) -->
	<path d="
		M 105 280
		C 105 240, 130 210, 175 198
		L 250 192
		C 280 190, 310 190, 340 192
		L 1620 192
		L 1660 192
		L 1660 490
		L 340 490
		C 310 490, 280 490, 250 490
		L 175 484
		C 130 472, 105 442, 105 402
		Z
	" stroke="currentColor" stroke-width="2"/>

	<!-- Roof curvature (hidden line showing roof camber) -->
	<path d="M 340 192 Q 900 168 1620 192" stroke="currentColor" stroke-width="1" stroke-dasharray="10 5"/>

	<!-- ========== CURVED WINDSHIELD (front/left) ========== -->
	<!-- Windshield — curved glass wrapping the front -->
	<path d="
		M 118 268
		C 118 248, 135 228, 160 218
		L 225 208
	" stroke="currentColor" stroke-width="1.5"/>
	<path d="
		M 118 400
		C 118 420, 135 440, 160 450
		L 225 460
	" stroke="currentColor" stroke-width="1.5"/>
	<!-- Windshield vertical divider -->
	<line x1="170" y1="215" x2="170" y2="455" stroke="currentColor" stroke-width="0.5" stroke-dasharray="4 3"/>

	<!-- LED destination sign above windshield -->
	<rect x="130" y="230" width="100" height="18" rx="4" stroke="currentColor" stroke-width="1"/>
	<text x="180" y="243" font-family="'JetBrains Mono', monospace" font-size="7" fill="currentColor" text-anchor="middle">DESTINATION</text>

	<!-- Red LED taillight bar at bottom of front face -->
	<line x1="108" y1="445" x2="108" y2="465" stroke="currentColor" stroke-width="2.5"/>
	<text x="72" y="460" font-family="'JetBrains Mono', monospace" font-size="7" fill="currentColor" text-anchor="middle">LED</text>

	<!-- ========== BLUE ACCENT STRIPE ========== -->
	<line x1="175" y1="385" x2="1660" y2="385" stroke="currentColor" stroke-width="1.5" stroke-dasharray="12 4"/>
	<text x="900" y="400" font-family="'JetBrains Mono', monospace" font-size="9" fill="currentColor" text-anchor="middle" opacity="0.7">BLUE ACCENT STRIPE</text>

	<!-- ========== DOORS (3 bi-parting pairs, 1.65m wide each) ========== -->
	<!-- Door 1 -->
	<rect x="370" y="232" width="32" height="248" rx="3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 2"/>
	<rect x="406" y="232" width="32" height="248" rx="3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 2"/>
	<line x1="403" y1="232" x2="403" y2="480" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2"/>
	<!-- Door 1 track -->
	<line x1="365" y1="232" x2="443" y2="232" stroke="currentColor" stroke-width="1"/>

	<!-- Door 2 -->
	<rect x="770" y="232" width="32" height="248" rx="3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 2"/>
	<rect x="806" y="232" width="32" height="248" rx="3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 2"/>
	<line x1="803" y1="232" x2="803" y2="480" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2"/>
	<!-- Door 2 track -->
	<line x1="765" y1="232" x2="843" y2="232" stroke="currentColor" stroke-width="1"/>

	<!-- Door 3 -->
	<rect x="1170" y="232" width="32" height="248" rx="3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 2"/>
	<rect x="1206" y="232" width="32" height="248" rx="3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 2"/>
	<line x1="1203" y1="232" x2="1203" y2="480" stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 2"/>
	<!-- Door 3 track -->
	<line x1="1165" y1="232" x2="1243" y2="232" stroke="currentColor" stroke-width="1"/>

	<!-- ========== PANORAMIC WINDOWS ========== -->
	<!-- Window: front section (between windshield and Door 1) -->
	<rect x="255" y="252" width="95" height="90" rx="10" stroke="currentColor" stroke-width="1.5"/>

	<!-- Windows: between Door 1 and Door 2 -->
	<rect x="460" y="252" width="130" height="90" rx="10" stroke="currentColor" stroke-width="1.5"/>
	<rect x="610" y="252" width="130" height="90" rx="10" stroke="currentColor" stroke-width="1.5"/>

	<!-- Windows: between Door 2 and Door 3 -->
	<rect x="860" y="252" width="130" height="90" rx="10" stroke="currentColor" stroke-width="1.5"/>
	<rect x="1010" y="252" width="130" height="90" rx="10" stroke="currentColor" stroke-width="1.5"/>

	<!-- Windows: after Door 3 to rear -->
	<rect x="1260" y="252" width="130" height="90" rx="10" stroke="currentColor" stroke-width="1.5"/>
	<rect x="1410" y="252" width="130" height="90" rx="10" stroke="currentColor" stroke-width="1.5"/>
	<rect x="1560" y="252" width="80" height="90" rx="10" stroke="currentColor" stroke-width="1.5"/>

	<!-- ========== ROOF EQUIPMENT ========== -->
	<!-- HVAC unit (centered, rectangular) -->
	<rect x="720" y="170" width="360" height="22" rx="6" stroke="currentColor" stroke-width="1" stroke-dasharray="6 3"/>
	<!-- HVAC louvers -->
	<line x1="780" y1="170" x2="780" y2="192" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>
	<line x1="840" y1="170" x2="840" y2="192" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>
	<line x1="900" y1="170" x2="900" y2="192" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>
	<line x1="960" y1="170" x2="960" y2="192" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>
	<line x1="1020" y1="170" x2="1020" y2="192" stroke="currentColor" stroke-width="0.5" opacity="0.5"/>
	<!-- HVAC label -->
	<text x="900" y="165" font-family="'JetBrains Mono', monospace" font-size="8" fill="currentColor" text-anchor="middle">HVAC</text>

	<!-- Pantograph / power pickup shoes (roof-mounted) -->
	<rect x="480" y="178" width="50" height="12" rx="3" stroke="currentColor" stroke-width="0.75"/>
	<rect x="1270" y="178" width="50" height="12" rx="3" stroke="currentColor" stroke-width="0.75"/>

	<!-- ========== GANGWAY CONNECTION (rear/right) ========== -->
	<!-- Continuous gangway — open bellows at rear end -->
	<path d="M 1660 230 h 30 v 230 h -30" stroke="currentColor" stroke-width="1.5"/>
	<line x1="1665" y1="240" x2="1685" y2="240" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<line x1="1665" y1="260" x2="1685" y2="260" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<line x1="1665" y1="280" x2="1685" y2="280" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<line x1="1665" y1="300" x2="1685" y2="300" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<line x1="1665" y1="320" x2="1685" y2="320" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<line x1="1665" y1="340" x2="1685" y2="340" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<line x1="1665" y1="360" x2="1685" y2="360" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<line x1="1665" y1="380" x2="1685" y2="380" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<line x1="1665" y1="400" x2="1685" y2="400" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<line x1="1665" y1="420" x2="1685" y2="420" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<line x1="1665" y1="440" x2="1685" y2="440" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<line x1="1665" y1="450" x2="1685" y2="450" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<text x="1700" y="348" font-family="'JetBrains Mono', monospace" font-size="7" fill="currentColor" text-anchor="middle" transform="rotate(90,1700,348)">GANGWAY</text>

	<!-- ========== FLOOR LINE (hidden) ========== -->
	<line x1="175" y1="480" x2="1660" y2="480" stroke="currentColor" stroke-width="1" stroke-dasharray="20 5 2 5"/>

	<!-- ========== BOGIES ========== -->
	<!-- Front bogie frame -->
	<rect x="250" y="495" width="200" height="38" rx="8" stroke="currentColor" stroke-width="1.5"/>
	<!-- Suspension struts -->
	<line x1="290" y1="490" x2="290" y2="495" stroke="currentColor" stroke-width="1.5"/>
	<line x1="410" y1="490" x2="410" y2="495" stroke="currentColor" stroke-width="1.5"/>

	<!-- Rear bogie frame -->
	<rect x="1350" y="495" width="200" height="38" rx="8" stroke="currentColor" stroke-width="1.5"/>
	<!-- Suspension struts -->
	<line x1="1390" y1="490" x2="1390" y2="495" stroke="currentColor" stroke-width="1.5"/>
	<line x1="1510" y1="490" x2="1510" y2="495" stroke="currentColor" stroke-width="1.5"/>

	<!-- ========== RUBBER TIRES (larger, on concrete rollway) ========== -->
	<!-- Front bogie — left tire -->
	<circle cx="300" cy="540" r="26" stroke="currentColor" stroke-width="2"/>
	<circle cx="300" cy="540" r="16" stroke="currentColor" stroke-width="1"/>
	<circle cx="300" cy="540" r="6" stroke="currentColor" stroke-width="1"/>
	<circle cx="300" cy="540" r="2" fill="currentColor"/>
	<!-- Tire tread pattern -->
	<path d="M 276 530 A 26 26 0 0 1 282 524" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>
	<path d="M 318 550 A 26 26 0 0 1 324 544" stroke="currentColor" stroke-width="0.5" opacity="0.4"/>

	<!-- Front bogie — right tire -->
	<circle cx="400" cy="540" r="26" stroke="currentColor" stroke-width="2"/>
	<circle cx="400" cy="540" r="16" stroke="currentColor" stroke-width="1"/>
	<circle cx="400" cy="540" r="6" stroke="currentColor" stroke-width="1"/>
	<circle cx="400" cy="540" r="2" fill="currentColor"/>

	<!-- Front bogie axle -->
	<line x1="300" y1="540" x2="400" y2="540" stroke="currentColor" stroke-width="1.5"/>

	<!-- Safety steel wheels (front bogie, riding above rail) -->
	<circle cx="335" cy="546" r="8" stroke="currentColor" stroke-width="0.75" stroke-dasharray="3 2"/>
	<circle cx="365" cy="546" r="8" stroke="currentColor" stroke-width="0.75" stroke-dasharray="3 2"/>
	<text x="350" y="564" font-family="'JetBrains Mono', monospace" font-size="6" fill="currentColor" text-anchor="middle" opacity="0.6">SAFETY</text>

	<!-- Rear bogie — left tire -->
	<circle cx="1400" cy="540" r="26" stroke="currentColor" stroke-width="2"/>
	<circle cx="1400" cy="540" r="16" stroke="currentColor" stroke-width="1"/>
	<circle cx="1400" cy="540" r="6" stroke="currentColor" stroke-width="1"/>
	<circle cx="1400" cy="540" r="2" fill="currentColor"/>

	<!-- Rear bogie — right tire -->
	<circle cx="1500" cy="540" r="26" stroke="currentColor" stroke-width="2"/>
	<circle cx="1500" cy="540" r="16" stroke="currentColor" stroke-width="1"/>
	<circle cx="1500" cy="540" r="6" stroke="currentColor" stroke-width="1"/>
	<circle cx="1500" cy="540" r="2" fill="currentColor"/>

	<!-- Rear bogie axle -->
	<line x1="1400" y1="540" x2="1500" y2="540" stroke="currentColor" stroke-width="1.5"/>

	<!-- Safety steel wheels (rear bogie) -->
	<circle cx="1435" cy="546" r="8" stroke="currentColor" stroke-width="0.75" stroke-dasharray="3 2"/>
	<circle cx="1465" cy="546" r="8" stroke="currentColor" stroke-width="0.75" stroke-dasharray="3 2"/>
	<text x="1450" y="564" font-family="'JetBrains Mono', monospace" font-size="6" fill="currentColor" text-anchor="middle" opacity="0.6">SAFETY</text>

	<!-- ========== GUIDE WHEELS (horizontal, on vertical guide bars) ========== -->
	<!-- Front bogie guide wheels -->
	<ellipse cx="262" cy="518" rx="12" ry="8" stroke="currentColor" stroke-width="1"/>
	<line x1="262" y1="510" x2="262" y2="526" stroke="currentColor" stroke-width="0.5"/>
	<ellipse cx="438" cy="518" rx="12" ry="8" stroke="currentColor" stroke-width="1"/>
	<line x1="438" y1="510" x2="438" y2="526" stroke="currentColor" stroke-width="0.5"/>

	<!-- Vertical guide bars (front) -->
	<line x1="248" y1="505" x2="248" y2="540" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>
	<line x1="452" y1="505" x2="452" y2="540" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>

	<!-- Rear bogie guide wheels -->
	<ellipse cx="1362" cy="518" rx="12" ry="8" stroke="currentColor" stroke-width="1"/>
	<line x1="1362" y1="510" x2="1362" y2="526" stroke="currentColor" stroke-width="0.5"/>
	<ellipse cx="1538" cy="518" rx="12" ry="8" stroke="currentColor" stroke-width="1"/>
	<line x1="1538" y1="510" x2="1538" y2="526" stroke="currentColor" stroke-width="0.5"/>

	<!-- Vertical guide bars (rear) -->
	<line x1="1348" y1="505" x2="1348" y2="540" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>
	<line x1="1552" y1="505" x2="1552" y2="540" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>

	<!-- ========== CONCRETE ROLLWAY INDICATOR ========== -->
	<rect x="260" y="543" width="180" height="4" rx="1" stroke="currentColor" stroke-width="0.5" opacity="0.35"/>
	<rect x="1360" y="543" width="180" height="4" rx="1" stroke="currentColor" stroke-width="0.5" opacity="0.35"/>
	<text x="350" y="578" font-family="'JetBrains Mono', monospace" font-size="6" fill="currentColor" text-anchor="middle" opacity="0.5">CONCRETE ROLLWAY</text>
	<text x="1450" y="578" font-family="'JetBrains Mono', monospace" font-size="6" fill="currentColor" text-anchor="middle" opacity="0.5">CONCRETE ROLLWAY</text>

	<!-- ========== DIMENSION ANNOTATIONS ========== -->

	<!-- Overall length: 16,900 mm -->
	<line x1="105" y1="600" x2="1660" y2="600" stroke="currentColor" stroke-width="1" stroke-dasharray="6 3"/>
	<line x1="105" y1="593" x2="105" y2="607" stroke="currentColor" stroke-width="1"/>
	<line x1="1660" y1="593" x2="1660" y2="607" stroke="currentColor" stroke-width="1"/>
	<!-- Arrowheads -->
	<path d="M 105 600 l 8 -3 v 6 z" fill="currentColor"/>
	<path d="M 1660 600 l -8 -3 v 6 z" fill="currentColor"/>
	<text x="882" y="618" font-family="'JetBrains Mono', monospace" font-size="14" fill="currentColor" text-anchor="middle">16,900 mm</text>

	<!-- Height: 3,490 mm (right side, vertical) -->
	<line x1="1740" y1="170" x2="1740" y2="540" stroke="currentColor" stroke-width="1" stroke-dasharray="6 3"/>
	<line x1="1733" y1="170" x2="1747" y2="170" stroke="currentColor" stroke-width="1"/>
	<line x1="1733" y1="540" x2="1747" y2="540" stroke="currentColor" stroke-width="1"/>
	<!-- Arrowheads -->
	<path d="M 1740 170 l -3 8 h 6 z" fill="currentColor"/>
	<path d="M 1740 540 l -3 -8 h 6 z" fill="currentColor"/>
	<text x="1755" y="360" font-family="'JetBrains Mono', monospace" font-size="12" fill="currentColor" transform="rotate(90,1755,360)" text-anchor="middle">3,490 mm</text>

	<!-- Door width: 1,650 mm (on Door 1) -->
	<line x1="370" y1="226" x2="438" y2="226" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>
	<line x1="370" y1="222" x2="370" y2="230" stroke="currentColor" stroke-width="0.75"/>
	<line x1="438" y1="222" x2="438" y2="230" stroke="currentColor" stroke-width="0.75"/>
	<text x="404" y="220" font-family="'JetBrains Mono', monospace" font-size="9" fill="currentColor" text-anchor="middle">1,650 mm</text>

	<!-- Bogie wheelbase: 2,000 mm (front bogie) -->
	<line x1="300" y1="585" x2="400" y2="585" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>
	<line x1="300" y1="581" x2="300" y2="589" stroke="currentColor" stroke-width="0.75"/>
	<line x1="400" y1="581" x2="400" y2="589" stroke="currentColor" stroke-width="0.75"/>
	<text x="350" y="596" font-family="'JetBrains Mono', monospace" font-size="9" fill="currentColor" text-anchor="middle">2,000 mm</text>

	<!-- Floor height: 1,200 mm (left side, from ground to floor) -->
	<line x1="60" y1="480" x2="60" y2="540" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>
	<line x1="54" y1="480" x2="66" y2="480" stroke="currentColor" stroke-width="0.75"/>
	<line x1="54" y1="540" x2="66" y2="540" stroke="currentColor" stroke-width="0.75"/>
	<text x="55" y="515" font-family="'JetBrains Mono', monospace" font-size="9" fill="currentColor" transform="rotate(-90,55,515)" text-anchor="middle">1,200 mm</text>

	<!-- ========== CENTER LINE (hidden structural datum) ========== -->
	<line x1="105" y1="345" x2="1660" y2="345" stroke="currentColor" stroke-width="0.5" stroke-dasharray="20 5 2 5"/>

	<!-- ========== DETAIL: Under-body equipment boxes ========== -->
	<rect x="500" y="483" width="80" height="14" rx="3" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 3"/>
	<rect x="650" y="483" width="60" height="14" rx="3" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 3"/>
	<rect x="1050" y="483" width="80" height="14" rx="3" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 3"/>
	<rect x="1200" y="483" width="60" height="14" rx="3" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 3"/>

	<!-- ========== TITLE BLOCK ========== -->
	<g transform="translate(1380,630)">
		<rect x="0" y="0" width="310" height="55" stroke="currentColor" stroke-width="1"/>
		<line x1="0" y1="18" x2="310" y2="18" stroke="currentColor" stroke-width="0.5"/>
		<line x1="0" y1="36" x2="310" y2="36" stroke="currentColor" stroke-width="0.5"/>
		<line x1="155" y1="0" x2="155" y2="55" stroke="currentColor" stroke-width="0.5"/>
		<text x="78" y="13" font-family="'JetBrains Mono', monospace" font-size="10" fill="currentColor" text-anchor="middle">STM / BOMBARDIER-ALSTOM</text>
		<text x="232" y="13" font-family="'JetBrains Mono', monospace" font-size="10" fill="currentColor" text-anchor="middle">MPM-10 AZUR MOTOR CAR</text>
		<text x="78" y="31" font-family="'JetBrains Mono', monospace" font-size="9" fill="currentColor" text-anchor="middle">SIDE ELEVATION</text>
		<text x="232" y="31" font-family="'JetBrains Mono', monospace" font-size="9" fill="currentColor" text-anchor="middle">SCALE 1:48</text>
		<text x="78" y="49" font-family="'JetBrains Mono', monospace" font-size="9" fill="currentColor" text-anchor="middle">MONTREAL QC</text>
		<text x="232" y="49" font-family="'JetBrains Mono', monospace" font-size="9" fill="currentColor" text-anchor="middle">DWG AZUR-001-A</text>
	</g>
</svg>
