<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} viewBox="0 0 1000 200" fill="none" xmlns="http://www.w3.org/2000/svg">
	<!-- Title block -->
	<text x="15" y="14" font-family="JetBrains Mono" font-size="8" fill="currentColor">COUPE G&#201;OLOGIQUE · PROFIL LONGITUDINAL</text>
	<line x1="15" y1="18" x2="340" y2="18" stroke="currentColor" stroke-width="0.5"/>

	<!-- Drawing number + scale -->
	<text x="860" y="14" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="end">&#201;CH. 1:500</text>
	<text x="980" y="14" font-family="JetBrains Mono" font-size="6" fill="currentColor" text-anchor="end">DWG GEO-003</text>

	<!-- Border frame -->
	<rect x="50" y="22" width="940" height="160" rx="2" stroke="currentColor" stroke-width="0.75" stroke-dasharray="4 2"/>

	<!-- === DEPTH SCALE (left side) === -->
	<line x1="55" y1="30" x2="55" y2="176" stroke="currentColor" stroke-width="0.5"/>
	<!-- Depth tick marks and labels -->
	<line x1="50" y1="38" x2="58" y2="38" stroke="currentColor" stroke-width="0.4"/>
	<text x="40" y="40" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="end">0m</text>

	<line x1="50" y1="62" x2="58" y2="62" stroke="currentColor" stroke-width="0.4"/>
	<text x="40" y="64" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="end">-5m</text>

	<line x1="50" y1="86" x2="58" y2="86" stroke="currentColor" stroke-width="0.4"/>
	<text x="40" y="88" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="end">-10m</text>

	<line x1="50" y1="110" x2="58" y2="110" stroke="currentColor" stroke-width="0.4"/>
	<text x="40" y="112" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="end">-15m</text>

	<line x1="50" y1="134" x2="58" y2="134" stroke="currentColor" stroke-width="0.4"/>
	<text x="40" y="136" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="end">-20m</text>

	<line x1="50" y1="158" x2="58" y2="158" stroke="currentColor" stroke-width="0.4"/>
	<text x="40" y="160" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="end">-25m</text>

	<!-- Depth axis label -->
	<text x="18" y="110" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="middle" transform="rotate(-90 18 110)">PROFONDEUR (m)</text>

	<!-- === GROUND SURFACE LINE === -->
	<path d="M65 38 Q110 34 160 37 T280 36 Q330 34 400 38 T530 35 Q580 33 650 37 T790 36 Q850 34 920 38 L980 37" stroke="currentColor" stroke-width="1" fill="none"/>
	<text x="520" y="32" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="middle">SURFACE</text>

	<!-- === STRATUM 1: REMBLAI (Fill) — top layer === -->
	<!-- Wavy boundary at ~50 -->
	<path d="M65 52 Q130 48 200 51 T350 50 Q420 47 500 52 T660 49 Q730 47 820 51 T980 50" stroke="currentColor" stroke-width="0.75"/>
	<!-- Dot pattern for fill material -->
	<circle cx="120" cy="44" r="0.6" fill="currentColor"/><circle cx="180" cy="42" r="0.6" fill="currentColor"/>
	<circle cx="250" cy="45" r="0.6" fill="currentColor"/><circle cx="320" cy="43" r="0.6" fill="currentColor"/>
	<circle cx="400" cy="44" r="0.6" fill="currentColor"/><circle cx="470" cy="43" r="0.6" fill="currentColor"/>
	<circle cx="550" cy="45" r="0.6" fill="currentColor"/><circle cx="630" cy="42" r="0.6" fill="currentColor"/>
	<circle cx="710" cy="44" r="0.6" fill="currentColor"/><circle cx="790" cy="43" r="0.6" fill="currentColor"/>
	<circle cx="870" cy="45" r="0.6" fill="currentColor"/><circle cx="940" cy="43" r="0.6" fill="currentColor"/>
	<!-- Label -->
	<text x="920" y="46" font-family="JetBrains Mono" font-size="5" fill="currentColor" text-anchor="end">REMBLAI</text>

	<!-- === STRATUM 2: ARGILE (Clay) === -->
	<!-- Wavy boundary at ~85 -->
	<path d="M65 82 Q140 86 220 83 T380 85 Q460 88 540 83 T710 86 Q790 88 870 84 T980 85" stroke="currentColor" stroke-width="0.75"/>
	<!-- Horizontal dash hatching for clay -->
	<line x1="80" y1="58" x2="94" y2="58" stroke="currentColor" stroke-width="0.3"/>
	<line x1="110" y1="62" x2="124" y2="62" stroke="currentColor" stroke-width="0.3"/>
	<line x1="150" y1="58" x2="164" y2="58" stroke="currentColor" stroke-width="0.3"/>
	<line x1="190" y1="64" x2="204" y2="64" stroke="currentColor" stroke-width="0.3"/>
	<line x1="230" y1="60" x2="244" y2="60" stroke="currentColor" stroke-width="0.3"/>
	<line x1="270" y1="66" x2="284" y2="66" stroke="currentColor" stroke-width="0.3"/>
	<line x1="310" y1="58" x2="324" y2="58" stroke="currentColor" stroke-width="0.3"/>
	<line x1="350" y1="63" x2="364" y2="63" stroke="currentColor" stroke-width="0.3"/>
	<line x1="390" y1="60" x2="404" y2="60" stroke="currentColor" stroke-width="0.3"/>
	<line x1="430" y1="65" x2="444" y2="65" stroke="currentColor" stroke-width="0.3"/>
	<line x1="470" y1="59" x2="484" y2="59" stroke="currentColor" stroke-width="0.3"/>
	<line x1="510" y1="64" x2="524" y2="64" stroke="currentColor" stroke-width="0.3"/>
	<line x1="550" y1="60" x2="564" y2="60" stroke="currentColor" stroke-width="0.3"/>
	<line x1="590" y1="66" x2="604" y2="66" stroke="currentColor" stroke-width="0.3"/>
	<line x1="630" y1="58" x2="644" y2="58" stroke="currentColor" stroke-width="0.3"/>
	<line x1="670" y1="63" x2="684" y2="63" stroke="currentColor" stroke-width="0.3"/>
	<line x1="710" y1="60" x2="724" y2="60" stroke="currentColor" stroke-width="0.3"/>
	<line x1="750" y1="65" x2="764" y2="65" stroke="currentColor" stroke-width="0.3"/>
	<line x1="790" y1="59" x2="804" y2="59" stroke="currentColor" stroke-width="0.3"/>
	<line x1="830" y1="64" x2="844" y2="64" stroke="currentColor" stroke-width="0.3"/>
	<line x1="870" y1="60" x2="884" y2="60" stroke="currentColor" stroke-width="0.3"/>
	<line x1="910" y1="66" x2="924" y2="66" stroke="currentColor" stroke-width="0.3"/>
	<line x1="950" y1="60" x2="964" y2="60" stroke="currentColor" stroke-width="0.3"/>
	<!-- Second row of dashes -->
	<line x1="95" y1="70" x2="109" y2="70" stroke="currentColor" stroke-width="0.3"/>
	<line x1="135" y1="74" x2="149" y2="74" stroke="currentColor" stroke-width="0.3"/>
	<line x1="175" y1="70" x2="189" y2="70" stroke="currentColor" stroke-width="0.3"/>
	<line x1="215" y1="75" x2="229" y2="75" stroke="currentColor" stroke-width="0.3"/>
	<line x1="255" y1="71" x2="269" y2="71" stroke="currentColor" stroke-width="0.3"/>
	<line x1="295" y1="76" x2="309" y2="76" stroke="currentColor" stroke-width="0.3"/>
	<line x1="335" y1="70" x2="349" y2="70" stroke="currentColor" stroke-width="0.3"/>
	<line x1="375" y1="74" x2="389" y2="74" stroke="currentColor" stroke-width="0.3"/>
	<line x1="415" y1="71" x2="429" y2="71" stroke="currentColor" stroke-width="0.3"/>
	<line x1="455" y1="76" x2="469" y2="76" stroke="currentColor" stroke-width="0.3"/>
	<line x1="495" y1="70" x2="509" y2="70" stroke="currentColor" stroke-width="0.3"/>
	<line x1="535" y1="74" x2="549" y2="74" stroke="currentColor" stroke-width="0.3"/>
	<line x1="575" y1="71" x2="589" y2="71" stroke="currentColor" stroke-width="0.3"/>
	<line x1="615" y1="76" x2="629" y2="76" stroke="currentColor" stroke-width="0.3"/>
	<line x1="655" y1="70" x2="669" y2="70" stroke="currentColor" stroke-width="0.3"/>
	<line x1="695" y1="74" x2="709" y2="74" stroke="currentColor" stroke-width="0.3"/>
	<line x1="735" y1="71" x2="749" y2="71" stroke="currentColor" stroke-width="0.3"/>
	<line x1="775" y1="76" x2="789" y2="76" stroke="currentColor" stroke-width="0.3"/>
	<line x1="815" y1="70" x2="829" y2="70" stroke="currentColor" stroke-width="0.3"/>
	<line x1="855" y1="74" x2="869" y2="74" stroke="currentColor" stroke-width="0.3"/>
	<line x1="895" y1="71" x2="909" y2="71" stroke="currentColor" stroke-width="0.3"/>
	<line x1="935" y1="76" x2="949" y2="76" stroke="currentColor" stroke-width="0.3"/>
	<!-- Label -->
	<text x="920" y="73" font-family="JetBrains Mono" font-size="5.5" fill="currentColor" text-anchor="end">ARGILE</text>

	<!-- === STRATUM 3: CALCAIRE (Limestone) === -->
	<!-- Wavy boundary at ~130 -->
	<path d="M65 128 Q150 132 240 129 T420 131 Q510 134 600 129 T780 132 Q860 134 940 130 L980 131" stroke="currentColor" stroke-width="0.75"/>
	<!-- Brick-like hatching for limestone -->
	<!-- Row 1 -->
	<line x1="80" y1="92" x2="120" y2="92" stroke="currentColor" stroke-width="0.3"/><line x1="130" y1="92" x2="170" y2="92" stroke="currentColor" stroke-width="0.3"/>
	<line x1="180" y1="92" x2="220" y2="92" stroke="currentColor" stroke-width="0.3"/><line x1="230" y1="92" x2="270" y2="92" stroke="currentColor" stroke-width="0.3"/>
	<line x1="280" y1="92" x2="320" y2="92" stroke="currentColor" stroke-width="0.3"/><line x1="330" y1="92" x2="370" y2="92" stroke="currentColor" stroke-width="0.3"/>
	<line x1="380" y1="92" x2="420" y2="92" stroke="currentColor" stroke-width="0.3"/><line x1="430" y1="92" x2="470" y2="92" stroke="currentColor" stroke-width="0.3"/>
	<line x1="480" y1="92" x2="520" y2="92" stroke="currentColor" stroke-width="0.3"/><line x1="530" y1="92" x2="570" y2="92" stroke="currentColor" stroke-width="0.3"/>
	<line x1="580" y1="92" x2="620" y2="92" stroke="currentColor" stroke-width="0.3"/><line x1="630" y1="92" x2="670" y2="92" stroke="currentColor" stroke-width="0.3"/>
	<line x1="680" y1="92" x2="720" y2="92" stroke="currentColor" stroke-width="0.3"/><line x1="730" y1="92" x2="770" y2="92" stroke="currentColor" stroke-width="0.3"/>
	<line x1="780" y1="92" x2="820" y2="92" stroke="currentColor" stroke-width="0.3"/><line x1="830" y1="92" x2="870" y2="92" stroke="currentColor" stroke-width="0.3"/>
	<line x1="880" y1="92" x2="920" y2="92" stroke="currentColor" stroke-width="0.3"/><line x1="930" y1="92" x2="970" y2="92" stroke="currentColor" stroke-width="0.3"/>
	<!-- Vertical joints row 1 -->
	<line x1="125" y1="86" x2="125" y2="98" stroke="currentColor" stroke-width="0.3"/>
	<line x1="175" y1="86" x2="175" y2="98" stroke="currentColor" stroke-width="0.3"/>
	<line x1="225" y1="86" x2="225" y2="98" stroke="currentColor" stroke-width="0.3"/>
	<line x1="325" y1="86" x2="325" y2="98" stroke="currentColor" stroke-width="0.3"/>
	<line x1="425" y1="86" x2="425" y2="98" stroke="currentColor" stroke-width="0.3"/>
	<line x1="525" y1="86" x2="525" y2="98" stroke="currentColor" stroke-width="0.3"/>
	<line x1="625" y1="86" x2="625" y2="98" stroke="currentColor" stroke-width="0.3"/>
	<line x1="725" y1="86" x2="725" y2="98" stroke="currentColor" stroke-width="0.3"/>
	<line x1="825" y1="86" x2="825" y2="98" stroke="currentColor" stroke-width="0.3"/>
	<line x1="925" y1="86" x2="925" y2="98" stroke="currentColor" stroke-width="0.3"/>
	<!-- Row 2 (offset) -->
	<line x1="100" y1="105" x2="140" y2="105" stroke="currentColor" stroke-width="0.3"/><line x1="150" y1="105" x2="190" y2="105" stroke="currentColor" stroke-width="0.3"/>
	<line x1="200" y1="105" x2="240" y2="105" stroke="currentColor" stroke-width="0.3"/><line x1="250" y1="105" x2="290" y2="105" stroke="currentColor" stroke-width="0.3"/>
	<line x1="300" y1="105" x2="340" y2="105" stroke="currentColor" stroke-width="0.3"/><line x1="350" y1="105" x2="390" y2="105" stroke="currentColor" stroke-width="0.3"/>
	<line x1="400" y1="105" x2="440" y2="105" stroke="currentColor" stroke-width="0.3"/><line x1="450" y1="105" x2="490" y2="105" stroke="currentColor" stroke-width="0.3"/>
	<line x1="500" y1="105" x2="540" y2="105" stroke="currentColor" stroke-width="0.3"/><line x1="550" y1="105" x2="590" y2="105" stroke="currentColor" stroke-width="0.3"/>
	<line x1="600" y1="105" x2="640" y2="105" stroke="currentColor" stroke-width="0.3"/><line x1="650" y1="105" x2="690" y2="105" stroke="currentColor" stroke-width="0.3"/>
	<line x1="700" y1="105" x2="740" y2="105" stroke="currentColor" stroke-width="0.3"/><line x1="750" y1="105" x2="790" y2="105" stroke="currentColor" stroke-width="0.3"/>
	<line x1="800" y1="105" x2="840" y2="105" stroke="currentColor" stroke-width="0.3"/><line x1="850" y1="105" x2="890" y2="105" stroke="currentColor" stroke-width="0.3"/>
	<line x1="900" y1="105" x2="940" y2="105" stroke="currentColor" stroke-width="0.3"/><line x1="950" y1="105" x2="970" y2="105" stroke="currentColor" stroke-width="0.3"/>
	<!-- Vertical joints row 2 -->
	<line x1="145" y1="99" x2="145" y2="111" stroke="currentColor" stroke-width="0.3"/>
	<line x1="195" y1="99" x2="195" y2="111" stroke="currentColor" stroke-width="0.3"/>
	<line x1="295" y1="99" x2="295" y2="111" stroke="currentColor" stroke-width="0.3"/>
	<line x1="395" y1="99" x2="395" y2="111" stroke="currentColor" stroke-width="0.3"/>
	<line x1="495" y1="99" x2="495" y2="111" stroke="currentColor" stroke-width="0.3"/>
	<line x1="595" y1="99" x2="595" y2="111" stroke="currentColor" stroke-width="0.3"/>
	<line x1="695" y1="99" x2="695" y2="111" stroke="currentColor" stroke-width="0.3"/>
	<line x1="795" y1="99" x2="795" y2="111" stroke="currentColor" stroke-width="0.3"/>
	<line x1="895" y1="99" x2="895" y2="111" stroke="currentColor" stroke-width="0.3"/>
	<!-- Row 3 -->
	<line x1="80" y1="118" x2="120" y2="118" stroke="currentColor" stroke-width="0.3"/><line x1="130" y1="118" x2="170" y2="118" stroke="currentColor" stroke-width="0.3"/>
	<line x1="180" y1="118" x2="220" y2="118" stroke="currentColor" stroke-width="0.3"/><line x1="230" y1="118" x2="270" y2="118" stroke="currentColor" stroke-width="0.3"/>
	<line x1="280" y1="118" x2="320" y2="118" stroke="currentColor" stroke-width="0.3"/><line x1="330" y1="118" x2="370" y2="118" stroke="currentColor" stroke-width="0.3"/>
	<line x1="380" y1="118" x2="420" y2="118" stroke="currentColor" stroke-width="0.3"/><line x1="430" y1="118" x2="470" y2="118" stroke="currentColor" stroke-width="0.3"/>
	<line x1="480" y1="118" x2="520" y2="118" stroke="currentColor" stroke-width="0.3"/><line x1="530" y1="118" x2="570" y2="118" stroke="currentColor" stroke-width="0.3"/>
	<line x1="580" y1="118" x2="620" y2="118" stroke="currentColor" stroke-width="0.3"/><line x1="630" y1="118" x2="670" y2="118" stroke="currentColor" stroke-width="0.3"/>
	<line x1="680" y1="118" x2="720" y2="118" stroke="currentColor" stroke-width="0.3"/><line x1="730" y1="118" x2="770" y2="118" stroke="currentColor" stroke-width="0.3"/>
	<line x1="780" y1="118" x2="820" y2="118" stroke="currentColor" stroke-width="0.3"/><line x1="830" y1="118" x2="870" y2="118" stroke="currentColor" stroke-width="0.3"/>
	<line x1="880" y1="118" x2="920" y2="118" stroke="currentColor" stroke-width="0.3"/><line x1="930" y1="118" x2="970" y2="118" stroke="currentColor" stroke-width="0.3"/>
	<!-- Vertical joints row 3 -->
	<line x1="125" y1="112" x2="125" y2="124" stroke="currentColor" stroke-width="0.3"/>
	<line x1="225" y1="112" x2="225" y2="124" stroke="currentColor" stroke-width="0.3"/>
	<line x1="325" y1="112" x2="325" y2="124" stroke="currentColor" stroke-width="0.3"/>
	<line x1="425" y1="112" x2="425" y2="124" stroke="currentColor" stroke-width="0.3"/>
	<line x1="525" y1="112" x2="525" y2="124" stroke="currentColor" stroke-width="0.3"/>
	<line x1="625" y1="112" x2="625" y2="124" stroke="currentColor" stroke-width="0.3"/>
	<line x1="725" y1="112" x2="725" y2="124" stroke="currentColor" stroke-width="0.3"/>
	<line x1="825" y1="112" x2="825" y2="124" stroke="currentColor" stroke-width="0.3"/>
	<line x1="925" y1="112" x2="925" y2="124" stroke="currentColor" stroke-width="0.3"/>
	<!-- Label -->
	<text x="920" y="110" font-family="JetBrains Mono" font-size="5.5" fill="currentColor" text-anchor="end">CALCAIRE</text>

	<!-- === STRATUM 4: ROCHE M&#200;RE (Bedrock) === -->
	<!-- Dense 45-degree cross-hatching for bedrock -->
	<!-- Forward diagonal hatching -->
	<path d="M70 135 l10 10 M90 135 l10 10 M110 135 l10 10 M130 135 l10 10 M150 135 l10 10 M170 135 l10 10 M190 135 l10 10 M210 135 l10 10 M230 135 l10 10 M250 135 l10 10 M270 135 l10 10 M290 135 l10 10 M310 135 l10 10 M330 135 l10 10 M350 135 l10 10 M370 135 l10 10 M390 135 l10 10 M410 135 l10 10 M430 135 l10 10 M450 135 l10 10 M470 135 l10 10 M490 135 l10 10 M510 135 l10 10 M530 135 l10 10 M550 135 l10 10 M570 135 l10 10 M590 135 l10 10 M610 135 l10 10 M630 135 l10 10 M650 135 l10 10 M670 135 l10 10 M690 135 l10 10 M710 135 l10 10 M730 135 l10 10 M750 135 l10 10 M770 135 l10 10 M790 135 l10 10 M810 135 l10 10 M830 135 l10 10 M850 135 l10 10 M870 135 l10 10 M890 135 l10 10 M910 135 l10 10 M930 135 l10 10 M950 135 l10 10 M970 135 l10 10" stroke="currentColor" stroke-width="0.3"/>
	<!-- Second forward diagonal row -->
	<path d="M70 150 l10 10 M90 150 l10 10 M110 150 l10 10 M130 150 l10 10 M150 150 l10 10 M170 150 l10 10 M190 150 l10 10 M210 150 l10 10 M230 150 l10 10 M250 150 l10 10 M270 150 l10 10 M290 150 l10 10 M310 150 l10 10 M330 150 l10 10 M350 150 l10 10 M370 150 l10 10 M390 150 l10 10 M410 150 l10 10 M430 150 l10 10 M450 150 l10 10 M470 150 l10 10 M490 150 l10 10 M510 150 l10 10 M530 150 l10 10 M550 150 l10 10 M570 150 l10 10 M590 150 l10 10 M610 150 l10 10 M630 150 l10 10 M650 150 l10 10 M670 150 l10 10 M690 150 l10 10 M710 150 l10 10 M730 150 l10 10 M750 150 l10 10 M770 150 l10 10 M790 150 l10 10 M810 150 l10 10 M830 150 l10 10 M850 150 l10 10 M870 150 l10 10 M890 150 l10 10 M910 150 l10 10 M930 150 l10 10 M950 150 l10 10 M970 150 l10 10" stroke="currentColor" stroke-width="0.3"/>
	<!-- Reverse diagonal hatching -->
	<path d="M80 145 l-10 10 M100 145 l-10 10 M120 145 l-10 10 M140 145 l-10 10 M160 145 l-10 10 M180 145 l-10 10 M200 145 l-10 10 M220 145 l-10 10 M240 145 l-10 10 M260 145 l-10 10 M280 145 l-10 10 M300 145 l-10 10 M320 145 l-10 10 M340 145 l-10 10 M360 145 l-10 10 M380 145 l-10 10 M400 145 l-10 10 M420 145 l-10 10 M440 145 l-10 10 M460 145 l-10 10 M480 145 l-10 10 M500 145 l-10 10 M520 145 l-10 10 M540 145 l-10 10 M560 145 l-10 10 M580 145 l-10 10 M600 145 l-10 10 M620 145 l-10 10 M640 145 l-10 10 M660 145 l-10 10 M680 145 l-10 10 M700 145 l-10 10 M720 145 l-10 10 M740 145 l-10 10 M760 145 l-10 10 M780 145 l-10 10 M800 145 l-10 10 M820 145 l-10 10 M840 145 l-10 10 M860 145 l-10 10 M880 145 l-10 10 M900 145 l-10 10 M920 145 l-10 10 M940 145 l-10 10 M960 145 l-10 10 M980 145 l-10 10" stroke="currentColor" stroke-width="0.3"/>
	<!-- Second reverse diagonal row -->
	<path d="M80 165 l-10 10 M100 165 l-10 10 M120 165 l-10 10 M140 165 l-10 10 M160 165 l-10 10 M180 165 l-10 10 M200 165 l-10 10 M220 165 l-10 10 M240 165 l-10 10 M260 165 l-10 10 M280 165 l-10 10 M300 165 l-10 10 M320 165 l-10 10 M340 165 l-10 10 M360 165 l-10 10 M380 165 l-10 10 M400 165 l-10 10 M420 165 l-10 10 M440 165 l-10 10 M460 165 l-10 10 M480 165 l-10 10 M500 165 l-10 10 M520 165 l-10 10 M540 165 l-10 10 M560 165 l-10 10 M580 165 l-10 10 M600 165 l-10 10 M620 165 l-10 10 M640 165 l-10 10 M660 165 l-10 10 M680 165 l-10 10 M700 165 l-10 10 M720 165 l-10 10 M740 165 l-10 10 M760 165 l-10 10 M780 165 l-10 10 M800 165 l-10 10 M820 165 l-10 10 M840 165 l-10 10 M860 165 l-10 10 M880 165 l-10 10 M900 165 l-10 10 M920 165 l-10 10 M940 165 l-10 10 M960 165 l-10 10 M980 165 l-10 10" stroke="currentColor" stroke-width="0.3"/>
	<!-- Label -->
	<text x="920" y="155" font-family="JetBrains Mono" font-size="5.5" fill="currentColor" text-anchor="end">ROCHE M&#200;RE</text>

	<!-- === BOREHOLE MARKERS (along top) === -->
	<!-- BH-1 -->
	<line x1="150" y1="26" x2="150" y2="176" stroke="currentColor" stroke-width="0.4" stroke-dasharray="3 4"/>
	<circle cx="150" cy="26" r="3" stroke="currentColor" stroke-width="0.5" fill="currentColor" fill-opacity="0.15"/>
	<text x="150" y="28" font-family="JetBrains Mono" font-size="3.5" fill="currentColor" text-anchor="middle">BH</text>
	<text x="155" y="24" font-family="JetBrains Mono" font-size="4" fill="currentColor">F-01</text>

	<!-- BH-2 -->
	<line x1="320" y1="26" x2="320" y2="176" stroke="currentColor" stroke-width="0.4" stroke-dasharray="3 4"/>
	<circle cx="320" cy="26" r="3" stroke="currentColor" stroke-width="0.5" fill="currentColor" fill-opacity="0.15"/>
	<text x="320" y="28" font-family="JetBrains Mono" font-size="3.5" fill="currentColor" text-anchor="middle">BH</text>
	<text x="325" y="24" font-family="JetBrains Mono" font-size="4" fill="currentColor">F-02</text>

	<!-- BH-3 -->
	<line x1="510" y1="26" x2="510" y2="176" stroke="currentColor" stroke-width="0.4" stroke-dasharray="3 4"/>
	<circle cx="510" cy="26" r="3" stroke="currentColor" stroke-width="0.5" fill="currentColor" fill-opacity="0.15"/>
	<text x="510" y="28" font-family="JetBrains Mono" font-size="3.5" fill="currentColor" text-anchor="middle">BH</text>
	<text x="515" y="24" font-family="JetBrains Mono" font-size="4" fill="currentColor">F-03</text>

	<!-- BH-4 -->
	<line x1="690" y1="26" x2="690" y2="176" stroke="currentColor" stroke-width="0.4" stroke-dasharray="3 4"/>
	<circle cx="690" cy="26" r="3" stroke="currentColor" stroke-width="0.5" fill="currentColor" fill-opacity="0.15"/>
	<text x="690" y="28" font-family="JetBrains Mono" font-size="3.5" fill="currentColor" text-anchor="middle">BH</text>
	<text x="695" y="24" font-family="JetBrains Mono" font-size="4" fill="currentColor">F-04</text>

	<!-- BH-5 -->
	<line x1="860" y1="26" x2="860" y2="176" stroke="currentColor" stroke-width="0.4" stroke-dasharray="3 4"/>
	<circle cx="860" cy="26" r="3" stroke="currentColor" stroke-width="0.5" fill="currentColor" fill-opacity="0.15"/>
	<text x="860" y="28" font-family="JetBrains Mono" font-size="3.5" fill="currentColor" text-anchor="middle">BH</text>
	<text x="865" y="24" font-family="JetBrains Mono" font-size="4" fill="currentColor">F-05</text>

	<!-- === HORIZONTAL DISTANCE SCALE (bottom) === -->
	<line x1="65" y1="186" x2="980" y2="186" stroke="currentColor" stroke-width="0.5"/>
	<line x1="65" y1="183" x2="65" y2="189" stroke="currentColor" stroke-width="0.4"/>
	<text x="65" y="195" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="middle">PK 0+000</text>
	<line x1="248" y1="183" x2="248" y2="189" stroke="currentColor" stroke-width="0.4"/>
	<text x="248" y="195" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="middle">PK 0+100</text>
	<line x1="431" y1="183" x2="431" y2="189" stroke="currentColor" stroke-width="0.4"/>
	<text x="431" y="195" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="middle">PK 0+200</text>
	<line x1="614" y1="183" x2="614" y2="189" stroke="currentColor" stroke-width="0.4"/>
	<text x="614" y="195" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="middle">PK 0+300</text>
	<line x1="797" y1="183" x2="797" y2="189" stroke="currentColor" stroke-width="0.4"/>
	<text x="797" y="195" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="middle">PK 0+400</text>
	<line x1="980" y1="183" x2="980" y2="189" stroke="currentColor" stroke-width="0.4"/>
	<text x="980" y="195" font-family="JetBrains Mono" font-size="4.5" fill="currentColor" text-anchor="middle">PK 0+500</text>

	<!-- === LEGEND BOX (bottom-left) === -->
	<rect x="60" y="185" width="10" height="5" stroke="currentColor" stroke-width="0.3"/>
	<!-- Small hatching samples in legend would clutter; labels suffice -->
</svg>
