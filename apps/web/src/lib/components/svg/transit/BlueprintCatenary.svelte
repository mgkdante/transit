<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 500 130"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
>
	<!-- Title block -->
	<text x="10" y="14" font-family="JetBrains Mono" font-size="8" fill="currentColor"
		>CATÉNAIRE 25kV · SECTION TYPE CT-2</text
	>
	<line x1="10" y1="17" x2="260" y2="17" stroke="currentColor" stroke-width="0.5" />

	<!-- Border frame -->
	<rect
		x="3"
		y="20"
		width="494"
		height="106"
		rx="4"
		stroke="currentColor"
		stroke-width="0.75"
		stroke-dasharray="4 2"
	/>

	<!-- Ground / rail level line -->
	<line x1="30" y1="112" x2="470" y2="112" stroke="currentColor" stroke-width="1" />
	<line x1="30" y1="114" x2="470" y2="114" stroke="currentColor" stroke-width="0.5" />

	<!-- Rail ties / sleepers -->
	<path
		d="M50 110 v6 M70 110 v6 M90 110 v6 M110 110 v6 M130 110 v6 M150 110 v6 M170 110 v6 M190 110 v6 M210 110 v6 M230 110 v6 M250 110 v6 M270 110 v6 M290 110 v6 M310 110 v6 M330 110 v6 M350 110 v6 M370 110 v6 M390 110 v6 M410 110 v6 M430 110 v6 M450 110 v6"
		stroke="currentColor"
		stroke-width="0.3"
	/>

	<!-- Pole 1 (x=80) -->
	<line x1="80" y1="30" x2="80" y2="112" stroke="currentColor" stroke-width="1.5" />
	<rect x="74" y="108" width="12" height="4" stroke="currentColor" stroke-width="0.5" fill="none" />
	<!-- Cross-arm -->
	<line x1="64" y1="30" x2="96" y2="30" stroke="currentColor" stroke-width="1" />
	<!-- Insulators -->
	<line x1="68" y1="30" x2="68" y2="34" stroke="currentColor" stroke-width="0.5" />
	<circle cx="68" cy="35" r="1.5" stroke="currentColor" stroke-width="0.5" fill="none" />
	<line x1="92" y1="30" x2="92" y2="34" stroke="currentColor" stroke-width="0.5" />
	<circle cx="92" cy="35" r="1.5" stroke="currentColor" stroke-width="0.5" fill="none" />
	<!-- Steady arm -->
	<line x1="80" y1="42" x2="92" y2="42" stroke="currentColor" stroke-width="0.5" />
	<line x1="80" y1="38" x2="80" y2="46" stroke="currentColor" stroke-width="0.3" />

	<!-- Pole 2 (x=210) -->
	<line x1="210" y1="30" x2="210" y2="112" stroke="currentColor" stroke-width="1.5" />
	<rect
		x="204"
		y="108"
		width="12"
		height="4"
		stroke="currentColor"
		stroke-width="0.5"
		fill="none"
	/>
	<!-- Cross-arm -->
	<line x1="194" y1="30" x2="226" y2="30" stroke="currentColor" stroke-width="1" />
	<!-- Insulators -->
	<line x1="198" y1="30" x2="198" y2="34" stroke="currentColor" stroke-width="0.5" />
	<circle cx="198" cy="35" r="1.5" stroke="currentColor" stroke-width="0.5" fill="none" />
	<line x1="222" y1="30" x2="222" y2="34" stroke="currentColor" stroke-width="0.5" />
	<circle cx="222" cy="35" r="1.5" stroke="currentColor" stroke-width="0.5" fill="none" />
	<!-- Steady arm -->
	<line x1="210" y1="42" x2="222" y2="42" stroke="currentColor" stroke-width="0.5" />
	<line x1="210" y1="38" x2="210" y2="46" stroke="currentColor" stroke-width="0.3" />

	<!-- Pole 3 (x=340) -->
	<line x1="340" y1="30" x2="340" y2="112" stroke="currentColor" stroke-width="1.5" />
	<rect
		x="334"
		y="108"
		width="12"
		height="4"
		stroke="currentColor"
		stroke-width="0.5"
		fill="none"
	/>
	<!-- Cross-arm -->
	<line x1="324" y1="30" x2="356" y2="30" stroke="currentColor" stroke-width="1" />
	<!-- Insulators -->
	<line x1="328" y1="30" x2="328" y2="34" stroke="currentColor" stroke-width="0.5" />
	<circle cx="328" cy="35" r="1.5" stroke="currentColor" stroke-width="0.5" fill="none" />
	<line x1="352" y1="30" x2="352" y2="34" stroke="currentColor" stroke-width="0.5" />
	<circle cx="352" cy="35" r="1.5" stroke="currentColor" stroke-width="0.5" fill="none" />
	<!-- Steady arm -->
	<line x1="340" y1="42" x2="352" y2="42" stroke="currentColor" stroke-width="0.5" />
	<line x1="340" y1="38" x2="340" y2="46" stroke="currentColor" stroke-width="0.3" />

	<!-- Pole 4 (x=470) -->
	<line x1="470" y1="30" x2="470" y2="112" stroke="currentColor" stroke-width="1.5" />
	<rect
		x="464"
		y="108"
		width="12"
		height="4"
		stroke="currentColor"
		stroke-width="0.5"
		fill="none"
	/>
	<!-- Cross-arm -->
	<line x1="454" y1="30" x2="486" y2="30" stroke="currentColor" stroke-width="1" />
	<!-- Insulators -->
	<line x1="458" y1="30" x2="458" y2="34" stroke="currentColor" stroke-width="0.5" />
	<circle cx="458" cy="35" r="1.5" stroke="currentColor" stroke-width="0.5" fill="none" />
	<line x1="482" y1="30" x2="482" y2="34" stroke="currentColor" stroke-width="0.5" />
	<circle cx="482" cy="35" r="1.5" stroke="currentColor" stroke-width="0.5" fill="none" />
	<!-- Steady arm -->
	<line x1="470" y1="42" x2="482" y2="42" stroke="currentColor" stroke-width="0.5" />
	<line x1="470" y1="38" x2="470" y2="46" stroke="currentColor" stroke-width="0.3" />

	<!-- Messenger wire (straight, dashed — connects pole tops) -->
	<line
		x1="68"
		y1="37"
		x2="198"
		y2="37"
		stroke="currentColor"
		stroke-width="0.5"
		stroke-dasharray="6 3"
	/>
	<line
		x1="198"
		y1="37"
		x2="328"
		y2="37"
		stroke="currentColor"
		stroke-width="0.5"
		stroke-dasharray="6 3"
	/>
	<line
		x1="328"
		y1="37"
		x2="458"
		y2="37"
		stroke="currentColor"
		stroke-width="0.5"
		stroke-dasharray="6 3"
	/>

	<!-- Contact wire — catenary curves (sag between poles) -->
	<!-- Span 1: pole 1 to pole 2 -->
	<path d="M92 42 Q 145 62 222 42" stroke="currentColor" stroke-width="0.75" fill="none" />
	<!-- Span 2: pole 2 to pole 3 -->
	<path d="M222 42 Q 275 62 352 42" stroke="currentColor" stroke-width="0.75" fill="none" />
	<!-- Span 3: pole 3 to pole 4 -->
	<path d="M352 42 Q 405 62 482 42" stroke="currentColor" stroke-width="0.75" fill="none" />

	<!-- Droppers — span 1 (3 droppers) -->
	<line x1="122" y1="39" x2="122" y2="49" stroke="currentColor" stroke-width="0.3" />
	<line x1="145" y1="38" x2="145" y2="53" stroke="currentColor" stroke-width="0.3" />
	<line x1="168" y1="39" x2="168" y2="49" stroke="currentColor" stroke-width="0.3" />

	<!-- Droppers — span 2 (3 droppers) -->
	<line x1="252" y1="39" x2="252" y2="49" stroke="currentColor" stroke-width="0.3" />
	<line x1="275" y1="38" x2="275" y2="53" stroke="currentColor" stroke-width="0.3" />
	<line x1="298" y1="39" x2="298" y2="49" stroke="currentColor" stroke-width="0.3" />

	<!-- Droppers — span 3 (3 droppers) -->
	<line x1="382" y1="39" x2="382" y2="49" stroke="currentColor" stroke-width="0.3" />
	<line x1="405" y1="38" x2="405" y2="53" stroke="currentColor" stroke-width="0.3" />
	<line x1="428" y1="39" x2="428" y2="49" stroke="currentColor" stroke-width="0.3" />

	<!-- Height dimension (left side) — H=5.5m -->
	<line x1="42" y1="42" x2="42" y2="112" stroke="currentColor" stroke-width="0.3" />
	<line x1="38" y1="42" x2="46" y2="42" stroke="currentColor" stroke-width="0.3" />
	<line x1="38" y1="112" x2="46" y2="112" stroke="currentColor" stroke-width="0.3" />
	<text
		x="48"
		y="82"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="start">H = 5,5 m</text
	>

	<!-- Pole spacing dimension (bottom) — span 1 -->
	<line x1="80" y1="122" x2="210" y2="122" stroke="currentColor" stroke-width="0.3" />
	<line x1="80" y1="119" x2="80" y2="125" stroke="currentColor" stroke-width="0.3" />
	<line x1="210" y1="119" x2="210" y2="125" stroke="currentColor" stroke-width="0.3" />
	<text
		x="145"
		y="128"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="middle">63,0 m</text
	>

	<!-- Pole spacing dimension — span 2 -->
	<line x1="210" y1="122" x2="340" y2="122" stroke="currentColor" stroke-width="0.3" />
	<line x1="340" y1="119" x2="340" y2="125" stroke="currentColor" stroke-width="0.3" />
	<text
		x="275"
		y="128"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="middle">63,0 m</text
	>

	<!-- Pole spacing dimension — span 3 -->
	<line x1="340" y1="122" x2="470" y2="122" stroke="currentColor" stroke-width="0.3" />
	<line x1="470" y1="119" x2="470" y2="125" stroke="currentColor" stroke-width="0.3" />
	<text
		x="405"
		y="128"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="middle">63,0 m</text
	>

	<!-- Wire labels -->
	<text
		x="145"
		y="70"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="middle">FIL DE CONTACT</text
	>
	<line
		x1="145"
		y1="66"
		x2="145"
		y2="56"
		stroke="currentColor"
		stroke-width="0.2"
		stroke-dasharray="1 1"
	/>

	<text
		x="280"
		y="33"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="middle">PORTEUR</text
	>

	<!-- Voltage label -->
	<text
		x="410"
		y="80"
		font-family="JetBrains Mono"
		font-size="6"
		fill="currentColor"
		text-anchor="middle">25 kV ~ 50 Hz</text
	>

	<!-- Section reference -->
	<text
		x="460"
		y="14"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="end">DWG CT-2-003</text
	>

	<!-- Scale reference -->
	<text
		x="395"
		y="14"
		font-family="JetBrains Mono"
		font-size="5"
		fill="currentColor"
		text-anchor="end">ÉCH. 1:100</text
	>

	<!-- Tension weight indicators at pole 1 and pole 4 -->
	<rect x="72" y="88" width="6" height="12" stroke="currentColor" stroke-width="0.5" fill="none" />
	<text
		x="75"
		y="86"
		font-family="JetBrains Mono"
		font-size="4"
		fill="currentColor"
		text-anchor="middle">T</text
	>
	<rect x="462" y="88" width="6" height="12" stroke="currentColor" stroke-width="0.5" fill="none" />
	<text
		x="465"
		y="86"
		font-family="JetBrains Mono"
		font-size="4"
		fill="currentColor"
		text-anchor="middle">T</text
	>

	<!-- Grounding symbols at pole bases -->
	<line x1="80" y1="116" x2="80" y2="118" stroke="currentColor" stroke-width="0.5" />
	<line x1="76" y1="118" x2="84" y2="118" stroke="currentColor" stroke-width="0.5" />
	<line x1="77" y1="119.5" x2="83" y2="119.5" stroke="currentColor" stroke-width="0.4" />
	<line x1="78" y1="121" x2="82" y2="121" stroke="currentColor" stroke-width="0.3" />

	<line x1="470" y1="116" x2="470" y2="118" stroke="currentColor" stroke-width="0.5" />
	<line x1="466" y1="118" x2="474" y2="118" stroke="currentColor" stroke-width="0.5" />
	<line x1="467" y1="119.5" x2="473" y2="119.5" stroke="currentColor" stroke-width="0.4" />
	<line x1="468" y1="121" x2="472" y2="121" stroke="currentColor" stroke-width="0.3" />
</svg>
