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
		<line x1="34" y1="246" x2="806" y2="246" stroke-width="0.3" stroke-dasharray="20 5 2 5" />
		<line x1="420" y1="48" x2="420" y2="440" stroke-width="0.2" stroke-dasharray="8 3 2 3" />
		<text x="34" y="30" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="10">CS-04 · CODE / SYSTEM</text>
		<text x="806" y="30" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="8" text-anchor="end">FRONT ELEV · NTS</text>
	</g>

	<g data-motif="device-frame">
		<rect x="78" y="70" width="536" height="330" rx="8" stroke-width="2" />
		<rect x="90" y="82" width="512" height="306" rx="3" stroke-width="1.2" />
		<line x1="90" y1="118" x2="602" y2="118" stroke-width="1" />
		<line x1="202" y1="118" x2="202" y2="388" stroke-width="0.75" stroke-dasharray="4 2" />
		<path d="M104 142H184M104 164H170M104 186H180M104 222H166M104 244H184M104 266H158M104 316H178M104 338H166M104 360H184" stroke-width="0.5" stroke-dasharray="4 2" />
		<path d="M222 136H574M222 368H574" stroke-width="0.3" stroke-dasharray="2 4" />
		<text x="86" y="62" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="7">DEV-04 · TOOLING FRAME</text>
	</g>

	<g data-motif="window-controls">
		<circle cx="108" cy="100" r="5" stroke-width="0.75" />
		<circle cx="128" cy="100" r="5" stroke-width="0.75" />
		<circle cx="148" cy="100" r="5" stroke-width="0.75" />
		<path d="M106 100H110M126 100H130M146 98L150 102M150 98L146 102" stroke-width="0.5" />
		<rect x="180" y="92" width="386" height="16" rx="3" stroke-width="0.5" />
		<path d="M190 100H256M274 100H384M404 100H548" stroke-width="0.3" stroke-dasharray="3 3" />
	</g>

	<g data-motif="code-geometry">
		<polyline points="302,164 240,244 302,324" stroke-width="2.5" />
		<line x1="336" y1="330" x2="388" y2="158" stroke-width="2.5" />
		<polyline points="422,164 484,244 422,324" stroke-width="2.5" />
		<polyline points="284,190 248,244 284,298" stroke-width="0.5" stroke-dasharray="6 3" />
		<polyline points="440,190 476,244 440,298" stroke-width="0.5" stroke-dasharray="6 3" />
		<path d="M312 184H354M314 202H372M304 286H350M296 304H336M404 184H442M392 304H430" stroke-width="1" />
		<path d="M310 218H348M400 218H438M296 270H338M384 270H426" stroke-width="0.5" stroke-dasharray="4 2" />
		<circle cx="362" cy="244" r="32" stroke-width="0.75" stroke-dasharray="3 3" />
		<path d="M350 244H374M362 232V256" stroke-width="0.75" />
		<text x="362" y="348" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="7" text-anchor="middle">BRACKET / SLASH · CG-04</text>
	</g>

	<g data-motif="system-nodes">
		<rect x="662" y="104" width="108" height="50" rx="4" stroke-width="1.2" />
		<rect x="662" y="200" width="108" height="50" rx="4" stroke-width="1.2" />
		<rect x="662" y="296" width="108" height="50" rx="4" stroke-width="1.2" />
		<circle cx="678" cy="129" r="5" stroke-width="0.75" />
		<circle cx="678" cy="225" r="5" stroke-width="0.75" />
		<circle cx="678" cy="321" r="5" stroke-width="0.75" />
		<path d="M692 120H754M692 132H742M692 216H754M692 228H736M692 312H754M692 324H746" stroke-width="0.5" stroke-dasharray="3 3" />
		<path d="M614 144H638V129H662M614 246H638V225H662M614 330H638V321H662M716 154V200M716 250V296" stroke-width="1" />
		<path d="M652 125L662 129L652 133M652 221L662 225L652 229M652 317L662 321L652 325M712 190L716 200L720 190M712 286L716 296L720 286" stroke-width="0.75" />
		<circle cx="638" cy="129" r="2" fill="currentColor" stroke="none" />
		<circle cx="638" cy="225" r="2" fill="currentColor" stroke="none" />
		<circle cx="638" cy="321" r="2" fill="currentColor" stroke="none" />
		<g fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="6">
			<text x="716" y="96" text-anchor="middle">SYS-A</text>
			<text x="716" y="192" text-anchor="middle">SYS-B</text>
			<text x="716" y="288" text-anchor="middle">SYS-C</text>
		</g>
	</g>

	<g data-motif="dimensions">
		<path d="M78 432V416M614 432V416M78 426H614M78 422L86 426L78 430M614 422L606 426L614 430" stroke-width="0.75" />
		<text x="346" y="442" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="8" text-anchor="middle">536.0</text>
		<path d="M52 70H66M52 400H66M58 70V400M54 70L58 78L62 70M54 400L58 392L62 400" stroke-width="0.75" />
		<text x="42" y="235" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="8" text-anchor="middle" transform="rotate(-90 42 235)">330.0</text>
		<path d="M662 374V360H770V374M662 368H770" stroke-width="0.5" />
		<text x="716" y="365" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="6" text-anchor="middle">108.0</text>
		<path d="M78 70V52H614V70M78 60H614" stroke-width="0.5" />
		<text x="346" y="57" fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="6" text-anchor="middle">536.0</text>
	</g>

	<g data-motif="title-block">
		<rect x="474" y="452" width="354" height="58" rx="1" stroke-width="1" />
		<line x1="474" y1="471" x2="828" y2="471" stroke-width="0.5" />
		<line x1="474" y1="490" x2="828" y2="490" stroke-width="0.5" />
		<line x1="594" y1="452" x2="594" y2="510" stroke-width="0.5" />
		<line x1="732" y1="452" x2="732" y2="510" stroke-width="0.5" />
		<g fill="currentColor" stroke="none" font-family="var(--font-mono)" font-size="7">
			<text x="482" y="466">YESID / DEV</text><text x="602" y="466">CODE SYSTEM CS-04</text><text x="740" y="466">REV A</text>
			<text x="482" y="485">FRONT ELEV</text><text x="602" y="485">NTS</text><text x="740" y="485">SHT 04</text>
			<text x="482" y="505">DWG CTA-CS-04</text><text x="602" y="505">CHK 07</text><text x="740" y="505">ISS 04</text>
		</g>
	</g>
</svg>
