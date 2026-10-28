<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 160 110" fill="none" xmlns="http://www.w3.org/2000/svg">
	<!-- Title block -->
	<text x="5" y="9" font-family="JetBrains Mono" font-size="5" fill="currentColor">INJECTION DE COULIS · D&#201;TAIL</text>
	<line x1="5" y1="12" x2="120" y2="12" stroke="currentColor" stroke-width="0.5"/>

	<!-- Drawing number + scale -->
	<text x="125" y="9" font-family="JetBrains Mono" font-size="4" fill="currentColor">&#201;CH. 1:10</text>
	<text x="155" y="9" font-family="JetBrains Mono" font-size="4" fill="currentColor" text-anchor="end">DWG INJ-004</text>

	<!-- Border frame -->
	<rect x="3" y="14" width="154" height="90" rx="2" stroke="currentColor" stroke-width="0.5" stroke-dasharray="4 2"/>

	<!-- === SUPPLY LINE (from left) === -->
	<!-- Main pipe from pressure source -->
	<line x1="8" y1="55" x2="35" y2="55" stroke="currentColor" stroke-width="1.2"/>
	<line x1="8" y1="59" x2="35" y2="59" stroke="currentColor" stroke-width="1.2"/>
	<!-- Pipe label -->
	<text x="20" y="52" font-family="JetBrains Mono" font-size="3.5" fill="currentColor" text-anchor="middle">ALIMENTATION</text>
	<!-- Flow arrows inside pipe -->
	<path d="M14 56 L18 57 L14 58" stroke="currentColor" stroke-width="0.4" fill="none"/>
	<path d="M24 56 L28 57 L24 58" stroke="currentColor" stroke-width="0.4" fill="none"/>

	<!-- === VALVE SYMBOL === -->
	<!-- Butterfly/gate valve (bowtie shape) -->
	<polygon points="35,52 42,57 35,62" stroke="currentColor" stroke-width="0.75" fill="currentColor" fill-opacity="0.1"/>
	<polygon points="49,52 42,57 49,62" stroke="currentColor" stroke-width="0.75" fill="currentColor" fill-opacity="0.1"/>
	<!-- Valve stem -->
	<line x1="42" y1="47" x2="42" y2="52" stroke="currentColor" stroke-width="0.75"/>
	<!-- Valve handwheel -->
	<circle cx="42" cy="44" r="3" stroke="currentColor" stroke-width="0.5"/>
	<line x1="39" y1="44" x2="45" y2="44" stroke="currentColor" stroke-width="0.4"/>
	<!-- Valve label -->
	<text x="42" y="39" font-family="JetBrains Mono" font-size="3" fill="currentColor" text-anchor="middle">VANNE</text>

	<!-- === PRESSURE GAUGE === -->
	<!-- Tee connection for gauge -->
	<line x1="42" y1="59" x2="42" y2="68" stroke="currentColor" stroke-width="0.5"/>
	<!-- Gauge circle -->
	<circle cx="42" cy="74" r="6" stroke="currentColor" stroke-width="0.75"/>
	<!-- Gauge face markings -->
	<path d="M38.5 71 L39.5 72" stroke="currentColor" stroke-width="0.3"/>
	<path d="M37.5 74 L38.5 74" stroke="currentColor" stroke-width="0.3"/>
	<path d="M38.5 77 L39.5 76" stroke="currentColor" stroke-width="0.3"/>
	<path d="M42 78 L42 77" stroke="currentColor" stroke-width="0.3"/>
	<path d="M45.5 77 L44.5 76" stroke="currentColor" stroke-width="0.3"/>
	<path d="M46.5 74 L45.5 74" stroke="currentColor" stroke-width="0.3"/>
	<path d="M45.5 71 L44.5 72" stroke="currentColor" stroke-width="0.3"/>
	<path d="M42 70 L42 71" stroke="currentColor" stroke-width="0.3"/>
	<!-- Gauge needle (pointing to ~10 o'clock = high pressure) -->
	<line x1="42" y1="74" x2="39" y2="70" stroke="currentColor" stroke-width="0.5"/>
	<!-- Gauge center dot -->
	<circle cx="42" cy="74" r="0.8" fill="currentColor"/>
	<!-- Pressure reading -->
	<text x="42" y="83" font-family="JetBrains Mono" font-size="3" fill="currentColor" text-anchor="middle">P = 8 bar</text>
	<!-- Gauge label -->
	<text x="42" y="88" font-family="JetBrains Mono" font-size="3" fill="currentColor" text-anchor="middle">MANOM&#200;TRE</text>

	<!-- === INJECTION PIPE (main horizontal) === -->
	<line x1="49" y1="55" x2="100" y2="55" stroke="currentColor" stroke-width="1.2"/>
	<line x1="49" y1="59" x2="100" y2="59" stroke="currentColor" stroke-width="1.2"/>
	<!-- Flow arrows in pipe -->
	<path d="M60 56 L64 57 L60 58" stroke="currentColor" stroke-width="0.4" fill="none"/>
	<path d="M75 56 L79 57 L75 58" stroke="currentColor" stroke-width="0.4" fill="none"/>
	<path d="M90 56 L94 57 L90 58" stroke="currentColor" stroke-width="0.4" fill="none"/>

	<!-- INJECTION label -->
	<text x="74" y="52" font-family="JetBrains Mono" font-size="4" fill="currentColor" text-anchor="middle">INJECTION</text>

	<!-- === NOZZLE (trapezoid at pipe end) === -->
	<polygon points="100,53 112,50 112,64 100,61" stroke="currentColor" stroke-width="0.75" fill="currentColor" fill-opacity="0.08"/>
	<!-- Nozzle internal detail lines -->
	<line x1="103" y1="54" x2="103" y2="60" stroke="currentColor" stroke-width="0.3"/>
	<line x1="107" y1="52" x2="107" y2="62" stroke="currentColor" stroke-width="0.3"/>
	<!-- Nozzle label -->
	<text x="106" y="68" font-family="JetBrains Mono" font-size="3" fill="currentColor" text-anchor="middle">BUSE</text>

	<!-- === SPRAY / FLOW PATTERN (dashed radiating lines from nozzle) === -->
	<!-- Central spray -->
	<line x1="112" y1="57" x2="148" y2="57" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 2"/>
	<!-- Upper spray lines -->
	<line x1="112" y1="53" x2="145" y2="38" stroke="currentColor" stroke-width="0.4" stroke-dasharray="3 2"/>
	<line x1="112" y1="55" x2="147" y2="47" stroke="currentColor" stroke-width="0.4" stroke-dasharray="3 2"/>
	<line x1="112" y1="51" x2="142" y2="30" stroke="currentColor" stroke-width="0.3" stroke-dasharray="2 2"/>
	<!-- Lower spray lines -->
	<line x1="112" y1="61" x2="145" y2="76" stroke="currentColor" stroke-width="0.4" stroke-dasharray="3 2"/>
	<line x1="112" y1="59" x2="147" y2="67" stroke="currentColor" stroke-width="0.4" stroke-dasharray="3 2"/>
	<line x1="112" y1="63" x2="142" y2="84" stroke="currentColor" stroke-width="0.3" stroke-dasharray="2 2"/>

	<!-- Spray zone outline (dashed arc) -->
	<path d="M140 32 Q152 57 140 82" stroke="currentColor" stroke-width="0.4" stroke-dasharray="3 2" fill="none"/>

	<!-- Grout spread indicators (small dots in spray zone) -->
	<circle cx="120" cy="50" r="0.5" fill="currentColor" fill-opacity="0.6"/>
	<circle cx="125" cy="45" r="0.5" fill="currentColor" fill-opacity="0.6"/>
	<circle cx="130" cy="42" r="0.5" fill="currentColor" fill-opacity="0.6"/>
	<circle cx="122" cy="57" r="0.5" fill="currentColor" fill-opacity="0.6"/>
	<circle cx="128" cy="57" r="0.5" fill="currentColor" fill-opacity="0.6"/>
	<circle cx="134" cy="57" r="0.5" fill="currentColor" fill-opacity="0.6"/>
	<circle cx="120" cy="64" r="0.5" fill="currentColor" fill-opacity="0.6"/>
	<circle cx="125" cy="69" r="0.5" fill="currentColor" fill-opacity="0.6"/>
	<circle cx="130" cy="72" r="0.5" fill="currentColor" fill-opacity="0.6"/>
	<circle cx="135" cy="50" r="0.5" fill="currentColor" fill-opacity="0.4"/>
	<circle cx="138" cy="65" r="0.5" fill="currentColor" fill-opacity="0.4"/>
	<circle cx="133" cy="38" r="0.5" fill="currentColor" fill-opacity="0.4"/>
	<circle cx="140" cy="55" r="0.5" fill="currentColor" fill-opacity="0.4"/>
	<circle cx="136" cy="43" r="0.5" fill="currentColor" fill-opacity="0.4"/>
	<circle cx="138" cy="70" r="0.5" fill="currentColor" fill-opacity="0.4"/>

	<!-- Spray zone label -->
	<text x="140" y="90" font-family="JetBrains Mono" font-size="3" fill="currentColor" text-anchor="middle">ZONE DE</text>
	<text x="140" y="94" font-family="JetBrains Mono" font-size="3" fill="currentColor" text-anchor="middle">TRAITEMENT</text>

	<!-- === DIMENSION LINES === -->
	<!-- Pipe length dimension -->
	<line x1="8" y1="97" x2="100" y2="97" stroke="currentColor" stroke-width="0.3"/>
	<line x1="8" y1="94" x2="8" y2="100" stroke="currentColor" stroke-width="0.3"/>
	<line x1="100" y1="94" x2="100" y2="100" stroke="currentColor" stroke-width="0.3"/>
	<text x="54" y="102" font-family="JetBrains Mono" font-size="3.5" fill="currentColor" text-anchor="middle">L = 1.80m</text>

	<!-- Nozzle length dimension -->
	<line x1="100" y1="25" x2="112" y2="25" stroke="currentColor" stroke-width="0.3"/>
	<line x1="100" y1="22" x2="100" y2="28" stroke="currentColor" stroke-width="0.3"/>
	<line x1="112" y1="22" x2="112" y2="28" stroke="currentColor" stroke-width="0.3"/>
	<text x="106" y="22" font-family="JetBrains Mono" font-size="3" fill="currentColor" text-anchor="middle">120mm</text>

	<!-- === ROCK/GROUND REPRESENTATION (around spray zone) === -->
	<!-- Cross-hatching around the injection zone -->
	<path d="M115 22 l5 5 M125 22 l5 5 M135 22 l5 5 M145 22 l5 5" stroke="currentColor" stroke-width="0.3"/>
	<path d="M148 30 l4 5 M148 40 l4 5 M148 50 l4 5 M148 60 l4 5 M148 70 l4 5 M148 80 l4 5" stroke="currentColor" stroke-width="0.3"/>
	<path d="M115 90 l5 -5 M125 90 l5 -5 M135 90 l5 -5 M145 90 l5 -5" stroke="currentColor" stroke-width="0.3"/>

	<!-- === SPEC TABLE === -->
	<rect x="5" y="17" width="42" height="28" stroke="currentColor" stroke-width="0.3"/>
	<line x1="5" y1="23" x2="47" y2="23" stroke="currentColor" stroke-width="0.3"/>
	<text x="26" y="22" font-family="JetBrains Mono" font-size="3" fill="currentColor" text-anchor="middle">SP&#201;CIFICATIONS</text>
	<text x="7" y="28" font-family="JetBrains Mono" font-size="2.5" fill="currentColor">TYPE: COULIS CIMENT</text>
	<text x="7" y="32" font-family="JetBrains Mono" font-size="2.5" fill="currentColor">E/C: 0.45</text>
	<text x="7" y="36" font-family="JetBrains Mono" font-size="2.5" fill="currentColor">PRESSION: 8 bar</text>
	<text x="7" y="40" font-family="JetBrains Mono" font-size="2.5" fill="currentColor">D&#201;BIT: 12 L/min</text>
	<text x="7" y="44" font-family="JetBrains Mono" font-size="2.5" fill="currentColor">RAYON: 1.5m</text>
</svg>
