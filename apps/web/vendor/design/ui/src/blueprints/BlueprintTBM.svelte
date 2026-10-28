<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 1200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
	<!-- Title block -->
	<text x="15" y="16" font-family="JetBrains Mono" font-size="9" fill="currentColor">TBM · TYPE EPB  &#216; 9.4m</text>
	<line x1="15" y1="20" x2="260" y2="20" stroke="currentColor" stroke-width="0.5"/>

	<!-- Border frame -->
	<rect x="5" y="24" width="1190" height="170" rx="4" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>

	<!-- === CUTTERHEAD (left) === -->
	<!-- Main cutterhead circle -->
	<circle cx="120" cy="110" r="55" stroke="currentColor" stroke-width="1.5"/>
	<!-- Inner ring 1 -->
	<circle cx="120" cy="110" r="40" stroke="currentColor" stroke-width="0.75"/>
	<!-- Inner ring 2 -->
	<circle cx="120" cy="110" r="25" stroke="currentColor" stroke-width="0.5"/>
	<!-- Hub -->
	<circle cx="120" cy="110" r="10" stroke="currentColor" stroke-width="1" fill="currentColor" fill-opacity="0.15"/>

	<!-- 8 spokes (radial lines) -->
	<line x1="120" y1="55" x2="120" y2="165" stroke="currentColor" stroke-width="0.5"/>
	<line x1="65" y1="110" x2="175" y2="110" stroke="currentColor" stroke-width="0.5"/>
	<line x1="81" y1="71" x2="159" y2="149" stroke="currentColor" stroke-width="0.5"/>
	<line x1="159" y1="71" x2="81" y2="149" stroke="currentColor" stroke-width="0.5"/>

	<!-- Disc cutters at face (small circles on outer ring) -->
	<circle cx="120" cy="55" r="3" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="120" cy="165" r="3" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="65" cy="110" r="3" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="175" cy="110" r="3" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="81" cy="71" r="3" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="159" cy="149" r="3" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="159" cy="71" r="3" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="81" cy="149" r="3" stroke="currentColor" stroke-width="0.75"/>
	<!-- Extra cutters on middle ring -->
	<circle cx="100" cy="73" r="2.5" stroke="currentColor" stroke-width="0.5"/>
	<circle cx="140" cy="73" r="2.5" stroke="currentColor" stroke-width="0.5"/>
	<circle cx="100" cy="147" r="2.5" stroke="currentColor" stroke-width="0.5"/>
	<circle cx="140" cy="147" r="2.5" stroke="currentColor" stroke-width="0.5"/>

	<!-- Cutterhead label -->
	<text x="120" y="40" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="middle">ROUE DE COUPE</text>
	<line x1="120" y1="42" x2="120" y2="52" stroke="currentColor" stroke-width="0.3" stroke-dasharray="2 2"/>

	<!-- === SHIELD BODY === -->
	<!-- Main shield rectangle -->
	<rect x="175" y="65" width="400" height="90" stroke="currentColor" stroke-width="1.2"/>
	<!-- Inner wall (double-wall shield) -->
	<rect x="178" y="68" width="394" height="84" stroke="currentColor" stroke-width="0.3" stroke-dasharray="3 2"/>

	<!-- Section division lines (dashed) -->
	<line x1="275" y1="65" x2="275" y2="155" stroke="currentColor" stroke-width="0.5" stroke-dasharray="4 3"/>
	<line x1="375" y1="65" x2="375" y2="155" stroke="currentColor" stroke-width="0.5" stroke-dasharray="4 3"/>
	<line x1="475" y1="65" x2="475" y2="155" stroke="currentColor" stroke-width="0.5" stroke-dasharray="4 3"/>

	<!-- Section labels -->
	<text x="225" y="60" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="middle">S1</text>
	<text x="325" y="60" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="middle">S2</text>
	<text x="425" y="60" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="middle">S3</text>
	<text x="540" y="60" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="middle">S4</text>

	<!-- Stiffener ribs inside shield -->
	<line x1="210" y1="68" x2="210" y2="152" stroke="currentColor" stroke-width="0.3"/>
	<line x1="240" y1="68" x2="240" y2="152" stroke="currentColor" stroke-width="0.3"/>
	<line x1="310" y1="68" x2="310" y2="152" stroke="currentColor" stroke-width="0.3"/>
	<line x1="340" y1="68" x2="340" y2="152" stroke="currentColor" stroke-width="0.3"/>
	<line x1="410" y1="68" x2="410" y2="152" stroke="currentColor" stroke-width="0.3"/>
	<line x1="440" y1="68" x2="440" y2="152" stroke="currentColor" stroke-width="0.3"/>
	<line x1="510" y1="68" x2="510" y2="152" stroke="currentColor" stroke-width="0.3"/>
	<line x1="540" y1="68" x2="540" y2="152" stroke="currentColor" stroke-width="0.3"/>

	<!-- Shield label -->
	<text x="375" y="115" font-family="JetBrains Mono" font-size="7" fill="currentColor" text-anchor="middle">BOUCLIER</text>

	<!-- === SCREW CONVEYOR (VIS SANS FIN) === -->
	<!-- Diagonal conveyor tube from cutterhead area down -->
	<line x1="145" y1="130" x2="310" y2="155" stroke="currentColor" stroke-width="1"/>
	<line x1="145" y1="135" x2="310" y2="160" stroke="currentColor" stroke-width="1"/>
	<!-- Zigzag pattern (auger flights) -->
	<path d="M155 131 l8 6 l-4 3 l8 5 l-4 3 l8 5 l-4 3 l8 5 l-4 3 l8 5 l-4 3 l8 5 l-4 3 l8 5 l-4 3 l8 5 l-4 3 l8 5 l-4 3 l8 5 l-4 3 l8 5" stroke="currentColor" stroke-width="0.5" fill="none"/>
	<!-- Conveyor motor housing -->
	<rect x="305" y="152" width="18" height="14" rx="2" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="314" cy="159" r="4" stroke="currentColor" stroke-width="0.5"/>
	<!-- Conveyor label -->
	<text x="240" y="175" font-family="JetBrains Mono" font-size="5.5" fill="currentColor" text-anchor="middle">VIS SANS FIN</text>
	<line x1="240" y1="171" x2="230" y2="158" stroke="currentColor" stroke-width="0.3" stroke-dasharray="2 1"/>

	<!-- === THRUST CYLINDERS (VÉRINS) === -->
	<!-- 4 thrust cylinder pairs at rear of shield -->
	<rect x="575" y="70" width="35" height="10" rx="1" stroke="currentColor" stroke-width="0.75"/>
	<rect x="575" y="85" width="35" height="10" rx="1" stroke="currentColor" stroke-width="0.75"/>
	<rect x="575" y="115" width="35" height="10" rx="1" stroke="currentColor" stroke-width="0.75"/>
	<rect x="575" y="130" width="35" height="10" rx="1" stroke="currentColor" stroke-width="0.75"/>
	<!-- Cylinder pistons (inner rectangles) -->
	<rect x="580" y="72" width="18" height="6" rx="0.5" stroke="currentColor" stroke-width="0.4" fill="currentColor" fill-opacity="0.1"/>
	<rect x="580" y="87" width="18" height="6" rx="0.5" stroke="currentColor" stroke-width="0.4" fill="currentColor" fill-opacity="0.1"/>
	<rect x="580" y="117" width="18" height="6" rx="0.5" stroke="currentColor" stroke-width="0.4" fill="currentColor" fill-opacity="0.1"/>
	<rect x="580" y="132" width="18" height="6" rx="0.5" stroke="currentColor" stroke-width="0.4" fill="currentColor" fill-opacity="0.1"/>
	<!-- Piston rods -->
	<line x1="598" y1="75" x2="615" y2="75" stroke="currentColor" stroke-width="0.75"/>
	<line x1="598" y1="90" x2="615" y2="90" stroke="currentColor" stroke-width="0.75"/>
	<line x1="598" y1="120" x2="615" y2="120" stroke="currentColor" stroke-width="0.75"/>
	<line x1="598" y1="135" x2="615" y2="135" stroke="currentColor" stroke-width="0.75"/>

	<!-- Vérins label -->
	<text x="593" y="112" font-family="JetBrains Mono" font-size="5.5" fill="currentColor" text-anchor="middle">V&#201;RINS</text>

	<!-- === TAIL SKIN (curved rear) === -->
	<!-- Tail skin curves -->
	<path d="M615 65 Q 640 65 645 72 L645 148 Q 640 155 615 155" stroke="currentColor" stroke-width="1.2" fill="none"/>
	<path d="M618 68 Q 636 68 640 74 L640 146 Q 636 152 618 152" stroke="currentColor" stroke-width="0.4" fill="none" stroke-dasharray="3 2"/>
	<!-- Tail seal brushes -->
	<line x1="638" y1="72" x2="648" y2="72" stroke="currentColor" stroke-width="0.5"/>
	<line x1="638" y1="78" x2="648" y2="78" stroke="currentColor" stroke-width="0.5"/>
	<line x1="638" y1="142" x2="648" y2="142" stroke="currentColor" stroke-width="0.5"/>
	<line x1="638" y1="148" x2="648" y2="148" stroke="currentColor" stroke-width="0.5"/>

	<!-- === VOUSSOIRS (installed rings behind tail) === -->
	<!-- Ring 1 -->
	<rect x="650" y="62" width="28" height="96" stroke="currentColor" stroke-width="1"/>
	<line x1="650" y1="78" x2="678" y2="78" stroke="currentColor" stroke-width="0.3"/>
	<line x1="650" y1="94" x2="678" y2="94" stroke="currentColor" stroke-width="0.3"/>
	<line x1="650" y1="110" x2="678" y2="110" stroke="currentColor" stroke-width="0.3"/>
	<line x1="650" y1="126" x2="678" y2="126" stroke="currentColor" stroke-width="0.3"/>
	<line x1="650" y1="142" x2="678" y2="142" stroke="currentColor" stroke-width="0.3"/>

	<!-- Ring 2 -->
	<rect x="680" y="62" width="28" height="96" stroke="currentColor" stroke-width="1"/>
	<line x1="680" y1="82" x2="708" y2="82" stroke="currentColor" stroke-width="0.3"/>
	<line x1="680" y1="102" x2="708" y2="102" stroke="currentColor" stroke-width="0.3"/>
	<line x1="680" y1="118" x2="708" y2="118" stroke="currentColor" stroke-width="0.3"/>
	<line x1="680" y1="138" x2="708" y2="138" stroke="currentColor" stroke-width="0.3"/>

	<!-- Ring 3 -->
	<rect x="710" y="62" width="28" height="96" stroke="currentColor" stroke-width="1"/>
	<line x1="710" y1="78" x2="738" y2="78" stroke="currentColor" stroke-width="0.3"/>
	<line x1="710" y1="94" x2="738" y2="94" stroke="currentColor" stroke-width="0.3"/>
	<line x1="710" y1="110" x2="738" y2="110" stroke="currentColor" stroke-width="0.3"/>
	<line x1="710" y1="126" x2="738" y2="126" stroke="currentColor" stroke-width="0.3"/>
	<line x1="710" y1="142" x2="738" y2="142" stroke="currentColor" stroke-width="0.3"/>

	<!-- Ring 4 -->
	<rect x="740" y="62" width="28" height="96" stroke="currentColor" stroke-width="1"/>
	<line x1="740" y1="82" x2="768" y2="82" stroke="currentColor" stroke-width="0.3"/>
	<line x1="740" y1="102" x2="768" y2="102" stroke="currentColor" stroke-width="0.3"/>
	<line x1="740" y1="118" x2="768" y2="118" stroke="currentColor" stroke-width="0.3"/>
	<line x1="740" y1="138" x2="768" y2="138" stroke="currentColor" stroke-width="0.3"/>

	<!-- Ring 5 -->
	<rect x="770" y="62" width="28" height="96" stroke="currentColor" stroke-width="1"/>
	<line x1="770" y1="78" x2="798" y2="78" stroke="currentColor" stroke-width="0.3"/>
	<line x1="770" y1="94" x2="798" y2="94" stroke="currentColor" stroke-width="0.3"/>
	<line x1="770" y1="110" x2="798" y2="110" stroke="currentColor" stroke-width="0.3"/>
	<line x1="770" y1="126" x2="798" y2="126" stroke="currentColor" stroke-width="0.3"/>

	<!-- Voussoirs label -->
	<text x="724" y="45" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="middle">VOUSSOIRS</text>
	<line x1="724" y1="47" x2="724" y2="60" stroke="currentColor" stroke-width="0.3" stroke-dasharray="2 2"/>

	<!-- === TUNNEL CONTINUATION (dashed beyond) === -->
	<line x1="798" y1="62" x2="850" y2="62" stroke="currentColor" stroke-width="0.75" stroke-dasharray="6 3"/>
	<line x1="798" y1="158" x2="850" y2="158" stroke="currentColor" stroke-width="0.75" stroke-dasharray="6 3"/>

	<!-- === GROUND / ROCK LINE (top and bottom) === -->
	<line x1="50" y1="35" x2="870" y2="35" stroke="currentColor" stroke-width="0.5" stroke-dasharray="8 4"/>
	<line x1="50" y1="185" x2="870" y2="185" stroke="currentColor" stroke-width="0.5" stroke-dasharray="8 4"/>
	<!-- Rock hatching (top) -->
	<path d="M60 33 l-4 -6 M90 33 l-4 -6 M120 33 l-4 -6 M150 33 l-4 -6 M180 33 l-4 -6 M210 33 l-4 -6 M240 33 l-4 -6 M270 33 l-4 -6 M300 33 l-4 -6 M330 33 l-4 -6 M360 33 l-4 -6 M390 33 l-4 -6 M420 33 l-4 -6 M450 33 l-4 -6 M480 33 l-4 -6 M510 33 l-4 -6 M540 33 l-4 -6 M570 33 l-4 -6 M600 33 l-4 -6 M630 33 l-4 -6 M660 33 l-4 -6 M690 33 l-4 -6 M720 33 l-4 -6 M750 33 l-4 -6 M780 33 l-4 -6 M810 33 l-4 -6 M840 33 l-4 -6 M870 33 l-4 -6" stroke="currentColor" stroke-width="0.3"/>
	<!-- Rock hatching (bottom) -->
	<path d="M60 187 l-4 6 M90 187 l-4 6 M120 187 l-4 6 M150 187 l-4 6 M180 187 l-4 6 M210 187 l-4 6 M240 187 l-4 6 M270 187 l-4 6 M300 187 l-4 6 M330 187 l-4 6 M360 187 l-4 6 M390 187 l-4 6 M420 187 l-4 6 M450 187 l-4 6 M480 187 l-4 6 M510 187 l-4 6 M540 187 l-4 6 M570 187 l-4 6 M600 187 l-4 6 M630 187 l-4 6 M660 187 l-4 6 M690 187 l-4 6 M720 187 l-4 6 M750 187 l-4 6 M780 187 l-4 6 M810 187 l-4 6 M840 187 l-4 6 M870 187 l-4 6" stroke="currentColor" stroke-width="0.3"/>

	<!-- === DIMENSION LINES === -->
	<!-- Cutterhead diameter -->
	<line x1="65" y1="175" x2="175" y2="175" stroke="currentColor" stroke-width="0.5"/>
	<line x1="65" y1="171" x2="65" y2="179" stroke="currentColor" stroke-width="0.5"/>
	<line x1="175" y1="171" x2="175" y2="179" stroke="currentColor" stroke-width="0.5"/>
	<text x="120" y="182" font-family="JetBrains Mono" font-size="5.5" fill="currentColor" text-anchor="middle">&#216; 9.4m</text>

	<!-- Shield length dimension -->
	<line x1="175" y1="175" x2="615" y2="175" stroke="currentColor" stroke-width="0.5"/>
	<line x1="175" y1="171" x2="175" y2="179" stroke="currentColor" stroke-width="0.5"/>
	<line x1="615" y1="171" x2="615" y2="179" stroke="currentColor" stroke-width="0.5"/>
	<text x="395" y="182" font-family="JetBrains Mono" font-size="5.5" fill="currentColor" text-anchor="middle">11.2m · BOUCLIER</text>

	<!-- Total length dimension -->
	<line x1="65" y1="192" x2="798" y2="192" stroke="currentColor" stroke-width="0.5"/>
	<line x1="65" y1="188" x2="65" y2="196" stroke="currentColor" stroke-width="0.5"/>
	<line x1="798" y1="188" x2="798" y2="196" stroke="currentColor" stroke-width="0.5"/>
	<text x="432" y="197" font-family="JetBrains Mono" font-size="5.5" fill="currentColor" text-anchor="middle">L = 18.6m  LONGUEUR TOTALE</text>

	<!-- === ANNOTATIONS (right side) === -->
	<!-- Reference marks -->
	<circle cx="900" cy="55" r="5" stroke="currentColor" stroke-width="0.5" fill="none"/>
	<text x="900" y="57" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="middle">A</text>
	<line x1="910" y1="55" x2="930" y2="55" stroke="currentColor" stroke-width="0.3"/>
	<text x="935" y="57" font-family="JetBrains Mono" font-size="5" fill="currentColor">AXE DU TUNNEL</text>

	<circle cx="900" cy="72" r="5" stroke="currentColor" stroke-width="0.5" fill="none"/>
	<text x="900" y="74" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="middle">B</text>
	<line x1="910" y1="72" x2="930" y2="72" stroke="currentColor" stroke-width="0.3"/>
	<text x="935" y="74" font-family="JetBrains Mono" font-size="5" fill="currentColor">JOINTS DE QUEUE</text>

	<circle cx="900" cy="89" r="5" stroke="currentColor" stroke-width="0.5" fill="none"/>
	<text x="900" y="91" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="middle">C</text>
	<line x1="910" y1="89" x2="930" y2="89" stroke="currentColor" stroke-width="0.3"/>
	<text x="935" y="91" font-family="JetBrains Mono" font-size="5" fill="currentColor">PRESSION DE FRONT</text>

	<!-- Centerline -->
	<line x1="50" y1="110" x2="850" y2="110" stroke="currentColor" stroke-width="0.3" stroke-dasharray="12 3 2 3"/>

	<!-- TBM specs table -->
	<rect x="880" y="105" width="300" height="75" stroke="currentColor" stroke-width="0.5"/>
	<line x1="880" y1="118" x2="1180" y2="118" stroke="currentColor" stroke-width="0.3"/>
	<text x="1030" y="114" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="middle">FICHE TECHNIQUE</text>
	<text x="890" y="130" font-family="JetBrains Mono" font-size="5" fill="currentColor">DIAM&#200;TRE D'EXCAVATION : 9.40 m</text>
	<text x="890" y="140" font-family="JetBrains Mono" font-size="5" fill="currentColor">DIAM&#200;TRE INT&#201;RIEUR : 8.60 m</text>
	<text x="890" y="150" font-family="JetBrains Mono" font-size="5" fill="currentColor">POUSS&#201;E MAX : 72 000 kN</text>
	<text x="890" y="160" font-family="JetBrains Mono" font-size="5" fill="currentColor">COUPLE MAX : 18 500 kNm</text>
	<text x="890" y="170" font-family="JetBrains Mono" font-size="5" fill="currentColor">MASSE TOTALE : 1 850 t</text>

	<!-- Scale reference -->
	<text x="1050" y="16" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="end">&#201;CH. 1:100</text>

	<!-- Drawing number -->
	<text x="1170" y="16" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="end">DWG TBM-001</text>
</svg>
