<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 100 260" fill="none" xmlns="http://www.w3.org/2000/svg">
	<!-- Title block -->
	<text x="6" y="10" font-family="JetBrains Mono" font-size="5" fill="currentColor">PUITS DE VENTILATION · TYPE PV-2</text>
	<line x1="6" y1="13" x2="94" y2="13" stroke="currentColor" stroke-width="0.5"/>

	<!-- Drawing number + scale -->
	<text x="60" y="21" font-family="JetBrains Mono" font-size="4" fill="currentColor">&#201;CH. 1:50</text>
	<text x="94" y="21" font-family="JetBrains Mono" font-size="4" fill="currentColor" text-anchor="end">DWG PV-002</text>

	<!-- === GROUND LEVEL INDICATOR === -->
	<line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="1"/>
	<!-- Ground hatching (45-degree ticks above ground line) -->
	<path d="M15 50 l-4 -6 M22 50 l-4 -6 M29 50 l-4 -6 M36 50 l-4 -6 M43 50 l-4 -6 M50 50 l-4 -6 M57 50 l-4 -6 M64 50 l-4 -6 M71 50 l-4 -6 M78 50 l-4 -6 M85 50 l-4 -6" stroke="currentColor" stroke-width="0.3"/>
	<text x="92" y="49" font-family="JetBrains Mono" font-size="3.5" fill="currentColor" text-anchor="end">N.S.</text>
	<text x="14" y="47" font-family="JetBrains Mono" font-size="3.5" fill="currentColor">&#177;0.00</text>

	<!-- === SHAFT HEAD STRUCTURE (above ground) === -->
	<rect x="32" y="34" width="36" height="16" stroke="currentColor" stroke-width="1"/>
	<!-- Louvres / ventilation grille -->
	<line x1="36" y1="37" x2="64" y2="37" stroke="currentColor" stroke-width="0.3"/>
	<line x1="36" y1="40" x2="64" y2="40" stroke="currentColor" stroke-width="0.3"/>
	<line x1="36" y1="43" x2="64" y2="43" stroke="currentColor" stroke-width="0.3"/>
	<line x1="36" y1="46" x2="64" y2="46" stroke="currentColor" stroke-width="0.3"/>
	<!-- Roof cap -->
	<path d="M30 34 L50 26 L70 34" stroke="currentColor" stroke-width="0.75"/>
	<line x1="30" y1="34" x2="70" y2="34" stroke="currentColor" stroke-width="0.75"/>
	<!-- Vent label -->
	<text x="50" y="30" font-family="JetBrains Mono" font-size="3" fill="currentColor" text-anchor="middle">GRILLE</text>

	<!-- === MAIN SHAFT WALLS === -->
	<!-- Left wall -->
	<line x1="34" y1="50" x2="34" y2="225" stroke="currentColor" stroke-width="1.2"/>
	<!-- Right wall -->
	<line x1="66" y1="50" x2="66" y2="225" stroke="currentColor" stroke-width="1.2"/>
	<!-- Inner lining (left) -->
	<line x1="37" y1="50" x2="37" y2="225" stroke="currentColor" stroke-width="0.4" stroke-dasharray="3 2"/>
	<!-- Inner lining (right) -->
	<line x1="63" y1="50" x2="63" y2="225" stroke="currentColor" stroke-width="0.4" stroke-dasharray="3 2"/>

	<!-- PUITS label (centered in shaft) -->
	<text x="50" y="90" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="middle" transform="rotate(-90 50 90)">PUITS</text>

	<!-- === LINING RING MARKS (horizontal lines at intervals) === -->
	<line x1="34" y1="62" x2="66" y2="62" stroke="currentColor" stroke-width="0.3"/>
	<line x1="34" y1="74" x2="66" y2="74" stroke="currentColor" stroke-width="0.3"/>
	<line x1="34" y1="86" x2="66" y2="86" stroke="currentColor" stroke-width="0.3"/>
	<line x1="34" y1="98" x2="66" y2="98" stroke="currentColor" stroke-width="0.3"/>
	<line x1="34" y1="110" x2="66" y2="110" stroke="currentColor" stroke-width="0.3"/>
	<line x1="34" y1="122" x2="66" y2="122" stroke="currentColor" stroke-width="0.3"/>
	<line x1="34" y1="134" x2="66" y2="134" stroke="currentColor" stroke-width="0.3"/>
	<line x1="34" y1="146" x2="66" y2="146" stroke="currentColor" stroke-width="0.3"/>
	<line x1="34" y1="158" x2="66" y2="158" stroke="currentColor" stroke-width="0.3"/>
	<line x1="34" y1="170" x2="66" y2="170" stroke="currentColor" stroke-width="0.3"/>
	<line x1="34" y1="182" x2="66" y2="182" stroke="currentColor" stroke-width="0.3"/>
	<line x1="34" y1="194" x2="66" y2="194" stroke="currentColor" stroke-width="0.3"/>
	<line x1="34" y1="206" x2="66" y2="206" stroke="currentColor" stroke-width="0.3"/>
	<line x1="34" y1="218" x2="66" y2="218" stroke="currentColor" stroke-width="0.3"/>

	<!-- === ACCESS LADDER === -->
	<!-- Ladder rails -->
	<line x1="54" y1="50" x2="54" y2="225" stroke="currentColor" stroke-width="0.5"/>
	<line x1="60" y1="50" x2="60" y2="225" stroke="currentColor" stroke-width="0.5"/>
	<!-- Ladder rungs -->
	<line x1="54" y1="56" x2="60" y2="56" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="64" x2="60" y2="64" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="72" x2="60" y2="72" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="80" x2="60" y2="80" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="88" x2="60" y2="88" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="96" x2="60" y2="96" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="104" x2="60" y2="104" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="112" x2="60" y2="112" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="120" x2="60" y2="120" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="128" x2="60" y2="128" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="136" x2="60" y2="136" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="144" x2="60" y2="144" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="152" x2="60" y2="152" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="160" x2="60" y2="160" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="168" x2="60" y2="168" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="176" x2="60" y2="176" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="184" x2="60" y2="184" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="192" x2="60" y2="192" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="200" x2="60" y2="200" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="208" x2="60" y2="208" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="216" x2="60" y2="216" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54" y1="224" x2="60" y2="224" stroke="currentColor" stroke-width="0.4"/>

	<!-- Ladder label -->
	<text x="12" y="142" font-family="JetBrains Mono" font-size="3.5" fill="currentColor" text-anchor="middle" transform="rotate(-90 12 142)">&#201;CHELLE D'ACC&#200;S</text>
	<line x1="18" y1="140" x2="53" y2="140" stroke="currentColor" stroke-width="0.3" stroke-dasharray="2 1"/>

	<!-- === GROUND / ROCK HATCHING (alongside shaft) === -->
	<!-- Left side hatching -->
	<path d="M20 55 l-5 7 M20 70 l-5 7 M20 85 l-5 7 M20 100 l-5 7 M20 115 l-5 7 M20 130 l-5 7 M20 145 l-5 7 M20 160 l-5 7 M20 175 l-5 7 M20 190 l-5 7 M20 205 l-5 7 M20 220 l-5 7" stroke="currentColor" stroke-width="0.3"/>
	<path d="M28 60 l-5 7 M28 75 l-5 7 M28 90 l-5 7 M28 105 l-5 7 M28 120 l-5 7 M28 135 l-5 7 M28 150 l-5 7 M28 165 l-5 7 M28 180 l-5 7 M28 195 l-5 7 M28 210 l-5 7" stroke="currentColor" stroke-width="0.3"/>
	<!-- Right side hatching -->
	<path d="M76 55 l5 7 M76 70 l5 7 M76 85 l5 7 M76 100 l5 7 M76 115 l5 7 M76 130 l5 7 M76 145 l5 7 M76 160 l5 7 M76 175 l5 7 M76 190 l5 7 M76 205 l5 7 M76 220 l5 7" stroke="currentColor" stroke-width="0.3"/>
	<path d="M84 60 l5 7 M84 75 l5 7 M84 90 l5 7 M84 105 l5 7 M84 120 l5 7 M84 135 l5 7 M84 150 l5 7 M84 165 l5 7 M84 180 l5 7 M84 195 l5 7 M84 210 l5 7" stroke="currentColor" stroke-width="0.3"/>

	<!-- === FAN HOUSING AT BASE === -->
	<!-- Base slab -->
	<line x1="30" y1="225" x2="70" y2="225" stroke="currentColor" stroke-width="1"/>
	<!-- Fan housing rectangle -->
	<rect x="34" y="225" width="32" height="18" rx="1" stroke="currentColor" stroke-width="0.75"/>
	<!-- Fan motor circle -->
	<circle cx="50" cy="234" r="6" stroke="currentColor" stroke-width="0.75"/>
	<!-- Fan hub -->
	<circle cx="50" cy="234" r="2" stroke="currentColor" stroke-width="0.5" fill="currentColor" fill-opacity="0.15"/>
	<!-- Fan blades (4 blades) -->
	<line x1="50" y1="228" x2="50" y2="240" stroke="currentColor" stroke-width="0.5"/>
	<line x1="44" y1="234" x2="56" y2="234" stroke="currentColor" stroke-width="0.5"/>
	<!-- Diagonal blades -->
	<line x1="45.8" y1="229.8" x2="54.2" y2="238.2" stroke="currentColor" stroke-width="0.4"/>
	<line x1="54.2" y1="229.8" x2="45.8" y2="238.2" stroke="currentColor" stroke-width="0.4"/>
	<!-- Fan label -->
	<text x="50" y="249" font-family="JetBrains Mono" font-size="4" fill="currentColor" text-anchor="middle">VENTILATEUR</text>

	<!-- === DIMENSION LINES === -->
	<!-- Shaft width dimension -->
	<line x1="34" y1="30" x2="66" y2="30" stroke="currentColor" stroke-width="0.4"/>
	<line x1="34" y1="27" x2="34" y2="33" stroke="currentColor" stroke-width="0.4"/>
	<line x1="66" y1="27" x2="66" y2="33" stroke="currentColor" stroke-width="0.4"/>
	<text x="50" y="29" font-family="JetBrains Mono" font-size="3.5" fill="currentColor" text-anchor="middle">&#216; 3.2m</text>

	<!-- Shaft depth dimension (right side) -->
	<line x1="72" y1="50" x2="72" y2="225" stroke="currentColor" stroke-width="0.4"/>
	<line x1="69" y1="50" x2="75" y2="50" stroke="currentColor" stroke-width="0.4"/>
	<line x1="69" y1="225" x2="75" y2="225" stroke="currentColor" stroke-width="0.4"/>
	<text x="76" y="140" font-family="JetBrains Mono" font-size="3.5" fill="currentColor" transform="rotate(90 76 140)">H = 35.0m</text>

	<!-- Depth marks on left side -->
	<text x="8" y="53" font-family="JetBrains Mono" font-size="3" fill="currentColor" text-anchor="end">0.00</text>
	<line x1="10" y1="50" x2="33" y2="50" stroke="currentColor" stroke-width="0.3" stroke-dasharray="2 2"/>
	<text x="8" y="143" font-family="JetBrains Mono" font-size="3" fill="currentColor" text-anchor="end">-17.5</text>
	<line x1="10" y1="140" x2="33" y2="140" stroke="currentColor" stroke-width="0.3" stroke-dasharray="2 2"/>
	<text x="8" y="228" font-family="JetBrains Mono" font-size="3" fill="currentColor" text-anchor="end">-35.0</text>
	<line x1="10" y1="225" x2="33" y2="225" stroke="currentColor" stroke-width="0.3" stroke-dasharray="2 2"/>

	<!-- === AIRFLOW ARROWS (inside shaft) === -->
	<!-- Upward airflow arrows -->
	<path d="M42 200 L42 180" stroke="currentColor" stroke-width="0.5"/>
	<path d="M39 183 L42 178 L45 183" stroke="currentColor" stroke-width="0.4" fill="none"/>
	<path d="M42 165 L42 145" stroke="currentColor" stroke-width="0.5"/>
	<path d="M39 148 L42 143 L45 148" stroke="currentColor" stroke-width="0.4" fill="none"/>
	<path d="M42 130 L42 110" stroke="currentColor" stroke-width="0.5"/>
	<path d="M39 113 L42 108 L45 113" stroke="currentColor" stroke-width="0.4" fill="none"/>
	<path d="M42 95 L42 75" stroke="currentColor" stroke-width="0.5"/>
	<path d="M39 78 L42 73 L45 78" stroke="currentColor" stroke-width="0.4" fill="none"/>
	<!-- Airflow label -->
	<text x="48" y="170" font-family="JetBrains Mono" font-size="3" fill="currentColor" transform="rotate(-90 48 170)">FLUX D'AIR</text>
</svg>
