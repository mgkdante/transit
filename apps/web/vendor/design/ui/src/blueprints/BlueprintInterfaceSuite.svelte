<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 840 520"
	preserveAspectRatio="xMidYMid meet"
	fill="none"
	color="currentColor"
	stroke="currentColor"
	aria-hidden="true"
	xmlns="http://www.w3.org/2000/svg"
>
	<g data-motif="sheet-frame">
		<rect x="6" y="6" width="828" height="508" rx="4" stroke-width="0.75" stroke-dasharray="4 2" />
		<path d="M6 22H22M14 6V22M818 6V22M818 14H834M6 498H22M14 498V514M818 498V514M818 506H834" stroke-width="0.5" />
		<line x1="34" y1="42" x2="806" y2="42" stroke-width="0.5" />
		<line x1="34" y1="235" x2="806" y2="235" stroke-width="0.3" stroke-dasharray="20 5 2 5" />
		<line x1="420" y1="48" x2="420" y2="438" stroke-width="0.2" stroke-dasharray="8 3 2 3" />
		<text x="34" y="30" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="10">IF-02 · DEVICE / INTERFACE</text>
		<text x="806" y="30" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="8" text-anchor="end">ELEV A · 1:6</text>
	</g>

	<g data-motif="website">
		<rect x="66" y="72" width="486" height="306" rx="8" stroke-width="2" />
		<rect x="78" y="84" width="462" height="282" rx="3" stroke-width="1.2" />
		<line x1="78" y1="112" x2="540" y2="112" stroke-width="1" />
		<circle cx="92" cy="98" r="4" stroke-width="0.75" />
		<circle cx="108" cy="98" r="4" stroke-width="0.75" />
		<circle cx="124" cy="98" r="4" stroke-width="0.75" />
		<rect x="150" y="92" width="350" height="12" rx="3" stroke-width="0.5" />
		<path d="M232 378L226 424M260 378L266 424" stroke-width="1.5" />
		<rect x="180" y="424" width="132" height="12" rx="2" stroke-width="2" />
		<text x="72" y="62" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="7">WEB-01 · FRONT ELEV</text>
	</g>

	<g data-motif="interface-panel">
		<line x1="190" y1="112" x2="190" y2="366" stroke-width="0.75" stroke-dasharray="4 2" />
		<rect x="92" y="128" width="82" height="18" rx="2" stroke-width="1" />
		<path d="M92 160H162M92 178H150M92 196H170M92 226H162M92 244H146M92 262H166M92 310H156M92 328H170" stroke-width="0.5" stroke-dasharray="4 2" />
		<circle cx="102" cy="212" r="4" stroke-width="0.75" />
		<circle cx="118" cy="212" r="4" stroke-width="0.75" />
		<circle cx="134" cy="212" r="4" stroke-width="0.75" />
		<rect x="208" y="128" width="150" height="70" rx="4" stroke-width="1.2" />
		<rect x="372" y="128" width="150" height="70" rx="4" stroke-width="1.2" />
		<path d="M220 144H298M220 158H336M220 172H316M384 144H484M384 158H506M384 172H468" stroke-width="0.5" stroke-dasharray="3 3" />
		<text x="212" y="122" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="6">PANEL A</text>
		<text x="376" y="122" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="6">PANEL B</text>
	</g>

	<g data-motif="chart-table">
		<rect x="208" y="216" width="150" height="132" rx="2" stroke-width="0.75" />
		<path d="M224 330V234M224 330H344M232 306L252 282L274 294L296 256L318 270L342 238" stroke-width="1" />
		<path d="M224 258H344M224 282H344M224 306H344" stroke-width="0.3" stroke-dasharray="4 2" />
		<circle cx="252" cy="282" r="2" fill="currentColor" stroke="none" />
		<circle cx="296" cy="256" r="2" fill="currentColor" stroke="none" />
		<circle cx="342" cy="238" r="2" fill="currentColor" stroke="none" />
		<rect x="372" y="216" width="150" height="132" rx="2" stroke-width="0.75" />
		<path d="M372 238H522M372 260H522M372 282H522M372 304H522M372 326H522M410 216V348M478 216V348" stroke-width="0.5" />
		<path d="M382 249H400M420 249H460M486 249H510M382 271H400M420 271H466M486 271H510M382 293H400M420 293H450M486 293H510M382 315H400M420 315H470M486 315H510" stroke-width="0.3" stroke-dasharray="2 2" />
	</g>

	<g data-motif="phone-app">
		<rect x="616" y="112" width="136" height="292" rx="12" stroke-width="2" />
		<rect x="626" y="136" width="116" height="238" rx="4" stroke-width="1.2" />
		<line x1="650" y1="124" x2="718" y2="124" stroke-width="0.75" />
		<line x1="662" y1="390" x2="706" y2="390" stroke-width="0.75" />
		<line x1="626" y1="158" x2="742" y2="158" stroke-width="0.5" />
		<rect x="638" y="176" width="92" height="52" rx="4" stroke-width="1" />
		<path d="M646 216L660 200L674 207L690 188L706 198L722 182" stroke-width="0.75" />
		<path d="M638 248H730M638 270H714M638 292H724M638 314H704M638 342H730" stroke-width="0.5" stroke-dasharray="4 2" />
		<path d="M552 166Q580 126 616 152M552 184Q582 224 616 210" stroke-width="0.75" stroke-dasharray="6 3" />
		<path d="M610 148L616 152L609 156M610 206L616 210L608 214" stroke-width="0.75" />
		<text x="684" y="102" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="7" text-anchor="middle">APP-01</text>
	</g>

	<g data-motif="dimensions">
		<path d="M66 447V433M552 447V433M66 440H552M66 436L74 440L66 444M552 436L544 440L552 444" stroke-width="0.75" />
		<text x="309" y="458" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="8" text-anchor="middle">610</text>
		<path d="M616 430V416M752 430V416M616 424H752M616 420L624 424L616 428M752 420L744 424L752 428" stroke-width="0.5" />
		<text x="684" y="440" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="7" text-anchor="middle">71</text>
		<path d="M778 112H764M778 404H764M772 112V404M768 112L772 120L776 112M768 404L772 396L776 404" stroke-width="0.75" />
		<text x="790" y="258" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="8" text-anchor="middle" transform="rotate(90 790 258)">146</text>
		<path d="M66 72V54H552V72M66 62H552" stroke-width="0.5" />
		<text x="309" y="59" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="6" text-anchor="middle">486.0</text>
	</g>

	<g data-motif="title-block">
		<rect x="474" y="452" width="354" height="58" rx="1" stroke-width="1" />
		<line x1="474" y1="471" x2="828" y2="471" stroke-width="0.5" />
		<line x1="474" y1="490" x2="828" y2="490" stroke-width="0.5" />
		<line x1="594" y1="452" x2="594" y2="510" stroke-width="0.5" />
		<line x1="732" y1="452" x2="732" y2="510" stroke-width="0.5" />
		<g fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="7">
			<text x="482" y="466">YESID / INFRA</text><text x="602" y="466">INTERFACE IF-02</text><text x="740" y="466">REV A</text>
			<text x="482" y="485">FRONT ELEV</text><text x="602" y="485">1:6</text><text x="740" y="485">SHT 02</text>
			<text x="482" y="505">DWG CTA-IF-02</text><text x="602" y="505">CHK 07</text><text x="740" y="505">ISS 04</text>
		</g>
	</g>
</svg>
