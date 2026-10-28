<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
	<!-- Title block -->
	<text x="10" y="14" font-family="JetBrains Mono" font-size="7" fill="currentColor">D&#201;TAIL · &#201;RECTEUR DE VOUSSOIRS</text>
	<line x1="10" y1="17" x2="190" y2="17" stroke="currentColor" stroke-width="0.5"/>

	<!-- Border frame -->
	<rect x="3" y="22" width="194" height="174" rx="3" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>

	<!-- === TUNNEL LINING REFERENCE (background arc) === -->
	<!-- Partial tunnel inner wall arc -->
	<path d="M20 170 Q 100 10 180 170" stroke="currentColor" stroke-width="0.5" stroke-dasharray="6 3"/>
	<!-- Partial tunnel outer wall arc -->
	<path d="M14 175 Q 100 3 186 175" stroke="currentColor" stroke-width="0.5" stroke-dasharray="6 3"/>

	<!-- === CENTRAL PIVOT POINT === -->
	<circle cx="100" cy="120" r="8" stroke="currentColor" stroke-width="1.2"/>
	<circle cx="100" cy="120" r="3" fill="currentColor"/>
	<!-- Cross-hair at pivot -->
	<line x1="88" y1="120" x2="112" y2="120" stroke="currentColor" stroke-width="0.3"/>
	<line x1="100" y1="108" x2="100" y2="132" stroke="currentColor" stroke-width="0.3"/>

	<!-- Pivot mounting plate -->
	<rect x="90" y="125" width="20" height="8" rx="1" stroke="currentColor" stroke-width="0.75"/>
	<!-- Mounting bolts -->
	<circle cx="95" cy="129" r="1.5" stroke="currentColor" stroke-width="0.4"/>
	<circle cx="105" cy="129" r="1.5" stroke="currentColor" stroke-width="0.4"/>

	<!-- Base pedestal -->
	<rect x="85" y="133" width="30" height="6" stroke="currentColor" stroke-width="0.5"/>
	<line x1="85" y1="139" x2="115" y2="139" stroke="currentColor" stroke-width="1"/>

	<!-- === ERECTOR ARM === -->
	<!-- Main arm (from pivot toward upper right) -->
	<line x1="106" y1="115" x2="160" y2="55" stroke="currentColor" stroke-width="1.5"/>
	<!-- Arm width (parallel line) -->
	<line x1="109" y1="117" x2="163" y2="57" stroke="currentColor" stroke-width="0.75"/>
	<!-- Arm structural detail -->
	<line x1="107" y1="116" x2="161" y2="56" stroke="currentColor" stroke-width="0.3" stroke-dasharray="4 2"/>

	<!-- Hydraulic cylinder along arm -->
	<rect x="118" y="96" width="22" height="5" rx="1" stroke="currentColor" stroke-width="0.5" transform="rotate(-45 129 98.5)"/>
	<rect x="122" y="97.5" width="10" height="2" rx="0.5" stroke="currentColor" stroke-width="0.3" fill="currentColor" fill-opacity="0.1" transform="rotate(-45 127 98.5)"/>

	<!-- === GRAB MECHANISM at arm end === -->
	<!-- Grab housing -->
	<rect x="153" y="42" width="22" height="18" rx="2" stroke="currentColor" stroke-width="1"/>
	<!-- Grab vacuum pad / grip lines -->
	<line x1="156" y1="46" x2="172" y2="46" stroke="currentColor" stroke-width="0.5"/>
	<line x1="156" y1="50" x2="172" y2="50" stroke="currentColor" stroke-width="0.5"/>
	<line x1="156" y1="54" x2="172" y2="54" stroke="currentColor" stroke-width="0.5"/>
	<!-- Suction cups -->
	<circle cx="160" cy="48" r="1.5" stroke="currentColor" stroke-width="0.4"/>
	<circle cx="168" cy="48" r="1.5" stroke="currentColor" stroke-width="0.4"/>
	<circle cx="160" cy="53" r="1.5" stroke="currentColor" stroke-width="0.4"/>
	<circle cx="168" cy="53" r="1.5" stroke="currentColor" stroke-width="0.4"/>
	<!-- Grab connection joint -->
	<circle cx="160" cy="55" r="3" stroke="currentColor" stroke-width="0.75"/>
	<circle cx="160" cy="55" r="1" fill="currentColor"/>

	<!-- Segment being placed (dashed outline) -->
	<rect x="148" y="30" width="30" height="10" rx="1" stroke="currentColor" stroke-width="0.75" stroke-dasharray="3 2"/>
	<text x="163" y="37" font-family="JetBrains Mono" font-size="4" fill="currentColor" text-anchor="middle">VOUSSOIR</text>

	<!-- === ARC GUIDE (rotation path) === -->
	<!-- Full rotation arc (dashed) -->
	<path d="M45 65 A 75 75 0 0 1 160 55" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 3"/>
	<!-- Secondary arc position -->
	<path d="M45 172 A 80 80 0 0 0 40 65" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>

	<!-- === ROTATION ARROW INDICATORS === -->
	<!-- Clockwise arrow at top of arc -->
	<path d="M52 68 l-8 -6 l2 5 l-5 2 Z" fill="currentColor" stroke="currentColor" stroke-width="0.3"/>
	<!-- Counter-clockwise arrow at bottom -->
	<path d="M48 168 l-6 8 l5 -2 l2 5 Z" fill="currentColor" stroke="currentColor" stroke-width="0.3"/>

	<!-- Rotation angle indicator -->
	<path d="M115 120 A 20 20 0 0 0 114 100" stroke="currentColor" stroke-width="0.3"/>
	<text x="122" y="108" font-family="JetBrains Mono" font-size="4.5" fill="currentColor">&#952;</text>

	<!-- Ghost positions of arm (faded) -->
	<!-- Position 2 (lower) -->
	<line x1="94" y1="115" x2="42" y2="170" stroke="currentColor" stroke-width="0.3" stroke-dasharray="4 4"/>
	<!-- Position 3 (upper left) -->
	<line x1="94" y1="118" x2="42" y2="68" stroke="currentColor" stroke-width="0.3" stroke-dasharray="4 4"/>

	<!-- === LABELS === -->
	<text x="100" y="150" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="middle">&#201;RECTEUR</text>

	<!-- Pivot label -->
	<line x1="78" y1="120" x2="60" y2="110" stroke="currentColor" stroke-width="0.3"/>
	<text x="30" y="109" font-family="JetBrains Mono" font-size="5" fill="currentColor">PIVOT</text>

	<!-- Arm label -->
	<line x1="135" y1="80" x2="145" y2="80" stroke="currentColor" stroke-width="0.3"/>
	<text x="148" y="82" font-family="JetBrains Mono" font-size="5" fill="currentColor">BRAS</text>

	<!-- Grab label -->
	<line x1="178" y1="51" x2="188" y2="51" stroke="currentColor" stroke-width="0.3"/>
	<text x="180" y="47" font-family="JetBrains Mono" font-size="4.5" fill="currentColor">PINCE DE</text>
	<text x="180" y="53" font-family="JetBrains Mono" font-size="4.5" fill="currentColor">PR&#201;HENSION</text>

	<!-- === TECHNICAL SPECS === -->
	<rect x="10" y="155" width="75" height="35" stroke="currentColor" stroke-width="0.4"/>
	<line x1="10" y1="163" x2="85" y2="163" stroke="currentColor" stroke-width="0.3"/>
	<text x="47" y="161" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="middle">SP&#201;CIFICATIONS</text>
	<text x="14" y="171" font-family="JetBrains Mono" font-size="4" fill="currentColor">PORT&#201;E : 4.7m</text>
	<text x="14" y="178" font-family="JetBrains Mono" font-size="4" fill="currentColor">CAPACIT&#201; : 12 t</text>
	<text x="14" y="185" font-family="JetBrains Mono" font-size="4" fill="currentColor">ROTATION : 360&#176;</text>

	<!-- Scale reference -->
	<text x="140" y="14" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="end">&#201;CH. 1:25</text>

	<!-- Drawing number -->
	<text x="192" y="14" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="end">DWG ER-001</text>
</svg>
