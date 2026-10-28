<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 600 200"
	preserveAspectRatio="xMidYMid meet"
	fill="none"
	color="currentColor"
	stroke="currentColor"
	aria-hidden="true"
	xmlns="http://www.w3.org/2000/svg"
>
	<g data-motif="sheet-frame">
		<rect x="4" y="4" width="592" height="192" rx="4" stroke-width="0.75" stroke-dasharray="4 2" />
		<path d="M4 16H16M10 4V16M584 4V16M584 10H596M4 184H16M10 184V196M584 184V196M584 190H596" stroke-width="0.5" />
		<line x1="20" y1="24" x2="580" y2="24" stroke-width="0.5" />
		<line x1="300" y1="16" x2="300" y2="152" stroke-width="0.2" stroke-dasharray="8 3 2 3" />
		<text x="20" y="17" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="8">TR-04 · 1:200</text>
		<text x="580" y="17" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="7" text-anchor="end">KM 2+000 / 2+560</text>
	</g>

	<g data-motif="twin-track">
		<line x1="28" y1="84" x2="572" y2="84" stroke-width="1.5" />
		<line x1="28" y1="96" x2="572" y2="96" stroke-width="1.5" />
		<line x1="28" y1="90" x2="572" y2="90" stroke-width="0.3" stroke-dasharray="6 4" />
		<line x1="28" y1="78" x2="572" y2="78" stroke-width="0.3" stroke-dasharray="2 4" />
		<line x1="28" y1="102" x2="292" y2="102" stroke-width="0.3" stroke-dasharray="2 4" />
		<line x1="360" y1="102" x2="572" y2="102" stroke-width="0.3" stroke-dasharray="2 4" />
	</g>

	<g data-motif="sleepers" stroke-width="0.75">
		<path d="M42 80V100M62 80V100M82 80V100M102 80V100M122 80V100M142 80V100M162 80V100M182 80V100M202 80V100M222 80V100M242 80V100M262 80V100M282 80V100M302 80V100M322 80V100M342 80V100M362 80V100M382 80V100M402 80V100M422 80V100M442 80V100M462 80V100M482 80V100M502 80V100M522 80V100M542 80V100M562 80V100" />
	</g>

	<g data-motif="turnout">
		<path d="M286 96Q340 116 398 132H568" stroke-width="1.5" />
		<path d="M286 96Q342 122 402 142H568" stroke-width="1.5" />
		<path d="M294 97Q344 119 400 137H568" stroke-width="0.3" stroke-dasharray="4 3" />
		<path d="M304 84L324 88L304 92M286 84L314 84M286 96L316 103" stroke-width="0.5" />
		<circle cx="286" cy="90" r="7" stroke-width="1" />
		<circle cx="286" cy="90" r="2" fill="currentColor" stroke="none" />
		<path d="M410 129L408 145M432 132L430 145M454 132L452 145M476 132L474 145M498 132L496 145M520 132L518 145M542 132L540 145M564 132L562 145" stroke-width="0.75" />
		<path d="M322 97A36 36 0 0 1 328 108" stroke-width="0.3" />
		<text x="330" y="113" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="5">1:14</text>
		<text x="286" y="116" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="6" text-anchor="middle">SW-14</text>
	</g>

	<g data-motif="stop">
		<g stroke-width="0.75">
			<circle cx="92" cy="90" r="6" /><circle cx="202" cy="90" r="6" />
			<circle cx="360" cy="90" r="6" /><circle cx="506" cy="90" r="6" />
		</g>
		<g fill="currentColor" stroke="none">
			<circle cx="92" cy="90" r="2" /><circle cx="202" cy="90" r="2" />
			<circle cx="360" cy="90" r="2" /><circle cx="506" cy="90" r="2" />
		</g>
		<path d="M92 78V62M202 78V62M360 78V62M506 78V62" stroke-width="0.3" />
		<g fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="5.5" text-anchor="middle">
			<text x="92" y="58">S01</text><text x="202" y="58">S02</text>
			<text x="360" y="58">S03</text><text x="506" y="58">S04</text>
		</g>
	</g>

	<g data-motif="metro-station">
		<rect x="326" y="34" width="210" height="34" rx="3" stroke-width="0.75" stroke-dasharray="6 3" />
		<line x1="326" y1="68" x2="536" y2="68" stroke-width="1" />
		<line x1="326" y1="72" x2="536" y2="72" stroke-width="0.3" stroke-dasharray="2 2" />
		<path d="M338 34V68M354 34V68M370 34V68M386 34V68M402 34V68M418 34V68M434 34V68M450 34V68M466 34V68M482 34V68M498 34V68M514 34V68M530 34V68" stroke-width="0.2" />
		<rect x="406" y="42" width="50" height="18" rx="2" stroke-width="1" />
		<path d="M418 60V48H444V60M431 48V60" stroke-width="0.5" />
		<text x="431" y="30" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="6" text-anchor="middle">MTR-S03 · PL-01</text>
	</g>

	<g data-motif="signal-gauge">
		<path d="M34 61V38M30 44L34 36L38 44" stroke-width="0.75" />
		<text x="34" y="69" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="5" text-anchor="middle">N</text>
		<rect x="258" y="64" width="8" height="13" rx="1" stroke-width="0.75" />
		<circle cx="262" cy="68" r="2" fill="var(--reflective)" stroke-width="0.5" />
		<line x1="262" y1="77" x2="262" y2="82" stroke-width="0.75" />
		<text x="262" y="61" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="5" text-anchor="middle">SG-14</text>
		<path d="M24 84H34M24 96H34M29 84V96" stroke-width="0.5" />
		<text x="20" y="92" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="4.5" text-anchor="end">1435</text>
		<line x1="42" y1="122" x2="378" y2="122" stroke-width="0.3" stroke-dasharray="20 5 2 5" />
		<path d="M92 116V128M202 116V128M286 116V128M360 116V128" stroke-width="0.5" />
		<g fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="4.5" text-anchor="middle">
			<text x="92" y="134">2+064</text><text x="202" y="134">2+174</text>
			<text x="286" y="134">2+258</text><text x="360" y="134">2+332</text>
		</g>
		<path d="M92 42V30H202V42M92 34H202" stroke-width="0.5" />
		<text x="147" y="31" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="5" text-anchor="middle">110.0</text>
	</g>

	<g data-motif="title-block">
		<rect x="406" y="156" width="184" height="34" rx="1" stroke-width="1" />
		<line x1="406" y1="167" x2="590" y2="167" stroke-width="0.5" />
		<line x1="406" y1="178" x2="590" y2="178" stroke-width="0.5" />
		<line x1="470" y1="156" x2="470" y2="190" stroke-width="0.5" />
		<line x1="548" y1="156" x2="548" y2="190" stroke-width="0.5" />
		<g fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="5">
			<text x="411" y="164">YESID / INFRA</text><text x="475" y="164">ROUTE TR-04</text><text x="553" y="164">REV A</text>
			<text x="411" y="175">PLAN / DATUM</text><text x="475" y="175">1:200</text><text x="553" y="175">SHT 01</text>
			<text x="411" y="187">DWG CTA-TR-01</text><text x="475" y="187">CHK 07</text><text x="553" y="187">ISS 04</text>
		</g>
	</g>
</svg>
