<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 840 260"
	preserveAspectRatio="xMidYMid meet"
	fill="none"
	color="currentColor"
	stroke="currentColor"
	aria-hidden="true"
	xmlns="http://www.w3.org/2000/svg"
>
	<g data-motif="sheet-frame">
		<rect x="5" y="5" width="830" height="250" rx="4" stroke-width="0.75" stroke-dasharray="4 2" />
		<path d="M5 19H19M12 5V19M821 5V19M821 12H835M5 241H19M12 241V255M821 241V255M821 248H835" stroke-width="0.5" />
		<line x1="26" y1="34" x2="814" y2="34" stroke-width="0.5" />
		<line x1="26" y1="112" x2="814" y2="112" stroke-width="0.2" stroke-dasharray="20 5 2 5" />
		<text x="26" y="24" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="9">DP-03 · FLOW / DATUM</text>
		<text x="814" y="24" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="7" text-anchor="end">CHAIN 0+000 / 0+720</text>
	</g>

	<g data-motif="source">
		<circle cx="104" cy="104" r="32" stroke-width="1.5" />
		<circle cx="104" cy="104" r="18" stroke-width="0.75" stroke-dasharray="3 3" />
		<circle cx="104" cy="104" r="5" fill="currentColor" stroke="none" />
		<path d="M104 66V52M98 56L104 50L110 56M66 104H52M56 98L50 104L56 110M104 142V154M98 150L104 156L110 150" stroke-width="0.75" />
		<text x="104" y="102" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="7" text-anchor="middle">SRC</text>
		<text x="104" y="114" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="5.5" text-anchor="middle">01 / RAW</text>
	</g>

	<g data-motif="transform">
		<rect x="264" y="68" width="160" height="72" rx="4" stroke-width="1.5" />
		<rect x="276" y="80" width="136" height="48" rx="2" stroke-width="0.75" />
		<path d="M290 92H332M290 104H354M290 116H320M370 88L394 104L370 120" stroke-width="1" />
		<line x1="360" y1="80" x2="360" y2="128" stroke-width="0.5" stroke-dasharray="3 3" />
		<circle cx="344" cy="104" r="4" stroke-width="0.75" />
		<text x="344" y="61" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="7" text-anchor="middle">ETL-02 · 3 PASS</text>
	</g>

	<g data-motif="store">
		<path d="M540 78A58 16 0 1 0 656 78A58 16 0 1 0 540 78" stroke-width="1.5" />
		<path d="M540 78V132C540 141 566 148 598 148C630 148 656 141 656 132V78" stroke-width="1.5" />
		<path d="M540 104A58 16 0 1 0 656 104A58 16 0 1 0 540 104" stroke-width="0.5" stroke-dasharray="3 2" />
		<path d="M540 132A58 16 0 1 0 656 132A58 16 0 1 0 540 132" stroke-width="0.75" />
		<path d="M554 93V132M642 93V132" stroke-width="0.3" stroke-dasharray="4 2" />
		<text x="598" y="105" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="7" text-anchor="middle">DATA-03</text>
		<text x="598" y="117" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="5.5" text-anchor="middle">STORE / V2</text>
		<circle cx="734" cy="104" r="24" stroke-width="1.2" />
		<circle cx="734" cy="104" r="10" stroke-width="0.75" />
		<path d="M724 104H744M734 94V114" stroke-width="0.5" />
		<text x="734" y="140" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="6" text-anchor="middle">OUT-04</text>
	</g>

	<g data-motif="flow-connectors">
		<path d="M136 92H214V88H264M136 116H214V120H264" stroke-width="1" />
		<path d="M424 88H486V78H540M424 120H486V132H540" stroke-width="1" />
		<path d="M656 90H682V104H710M656 122H682V104" stroke-width="1" />
		<path d="M254 84L264 88L254 92M254 116L264 120L254 124M530 74L540 78L530 82M530 128L540 132L530 136M700 100L710 104L700 108" stroke-width="0.75" />
		<circle cx="214" cy="88" r="2" fill="currentColor" stroke="none" />
		<circle cx="214" cy="120" r="2" fill="currentColor" stroke="none" />
		<circle cx="486" cy="78" r="2" fill="currentColor" stroke="none" />
		<circle cx="486" cy="132" r="2" fill="currentColor" stroke="none" />
		<path d="M168 92V116M460 88V120M682 90V122" stroke-width="0.3" stroke-dasharray="2 2" />
	</g>

	<g data-motif="rail-datum">
		<line x1="40" y1="178" x2="800" y2="178" stroke-width="1.2" />
		<line x1="40" y1="186" x2="800" y2="186" stroke-width="1.2" />
		<line x1="40" y1="182" x2="800" y2="182" stroke-width="0.3" stroke-dasharray="8 3 2 3" />
		<path d="M58 174V190M82 174V190M106 174V190M130 174V190M154 174V190M178 174V190M202 174V190M226 174V190M250 174V190M274 174V190M298 174V190M322 174V190M346 174V190M370 174V190M394 174V190M418 174V190M442 174V190M466 174V190M490 174V190M514 174V190M538 174V190M562 174V190M586 174V190M610 174V190M634 174V190M658 174V190M682 174V190M706 174V190M730 174V190M754 174V190M778 174V190" stroke-width="0.5" />
		<path d="M104 166V194M344 166V194M598 166V194M734 166V194" stroke-width="0.75" />
		<g fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="5.5" text-anchor="middle">
			<text x="104" y="202">0+064</text><text x="344" y="202">0+304</text>
			<text x="598" y="202">0+558</text><text x="734" y="202">0+694</text>
		</g>
	</g>

	<g data-motif="callout">
		<circle cx="344" cy="52" r="9" stroke-width="0.75" />
		<text x="344" y="55" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="7" text-anchor="middle">A</text>
		<path d="M353 52H472L500 72" stroke-width="0.5" />
		<text x="478" y="48" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="6" text-anchor="end">QA / LOCK 03</text>
		<path d="M598 156V164H734V156" stroke-width="0.5" />
		<text x="666" y="162" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="5" text-anchor="middle">136.0</text>
	</g>

	<g data-motif="title-block">
		<rect x="606" y="206" width="224" height="46" rx="1" stroke-width="1" />
		<line x1="606" y1="221" x2="830" y2="221" stroke-width="0.5" />
		<line x1="606" y1="236" x2="830" y2="236" stroke-width="0.5" />
		<line x1="678" y1="206" x2="678" y2="252" stroke-width="0.5" />
		<line x1="770" y1="206" x2="770" y2="252" stroke-width="0.5" />
		<g fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="5.5">
			<text x="612" y="217">YESID / DATA</text><text x="684" y="217">PIPELINE DP-03</text><text x="776" y="217">REV A</text>
			<text x="612" y="232">FLOW / DATUM</text><text x="684" y="232">NTS</text><text x="776" y="232">SHT 03</text>
			<text x="612" y="248">CTA-DP-03</text><text x="684" y="248">CHK 07</text><text x="776" y="248">ISS 04</text>
		</g>
	</g>
</svg>
