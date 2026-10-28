<script lang="ts">
	let {
		class: className = '',
		...rest
	}: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg
	class={className}
	{...rest}
	viewBox="0 0 460 310"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	preserveAspectRatio="xMidYMid meet"
>
	<rect
		x="7"
		y="7"
		width="446"
		height="296"
		rx="3"
		stroke="currentColor"
		stroke-width="0.8"
		stroke-dasharray="5 3"
	/>
	<text x="20" y="27" fill="currentColor" font-family="JetBrains Mono" font-size="9"
		>PASSENGER INFORMATION + STOP TECHNOLOGY</text
	>
	<text
		x="440"
		y="27"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="end">PIS-E11</text
	>

	<path d="M96 76V267M80 267H112M86 276H106" stroke="currentColor" stroke-width="1.5" />
	<circle cx="96" cy="67" r="26" stroke="currentColor" stroke-width="1.2" />
	<path d="M82 67H110M96 53V81" stroke="currentColor" stroke-width="0.8" />
	<rect x="52" y="103" width="88" height="62" rx="3" stroke="currentColor" stroke-width="1.1" />
	<path
		d="M62 116H130M62 128H123M62 140H128M62 152H112"
		stroke="currentColor"
		stroke-width="0.55"
	/>
	<rect x="66" y="181" width="60" height="38" rx="2" stroke="currentColor" stroke-width="0.9" />
	<path d="M76 192H116M76 203H108" stroke="currentColor" stroke-width="0.5" />
	<text
		x="96"
		y="236"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">NFC / QR</text
	>

	<rect x="182" y="69" width="126" height="92" rx="3" stroke="currentColor" stroke-width="1.2" />
	<rect x="193" y="81" width="104" height="52" stroke="currentColor" stroke-width="0.8" />
	<path d="M203 94H287M203 106H278M203 118H290" stroke="currentColor" stroke-width="0.6" />
	<path d="M203 145H222M232 145H251M261 145H280" stroke="currentColor" stroke-width="0.7" />
	<path d="M245 161V267M229 267H261M235 276H255" stroke="currentColor" stroke-width="1.2" />
	<text
		x="245"
		y="58"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">REAL-TIME DISPLAY</text
	>

	<rect x="350" y="112" width="64" height="108" rx="3" stroke="currentColor" stroke-width="1.1" />
	<path
		d="M360 126H404M360 139H404M360 152H404M360 165H404"
		stroke="currentColor"
		stroke-width="0.55"
	/>
	<circle cx="368" cy="185" r="5" stroke="currentColor" stroke-width="0.7" />
	<circle cx="386" cy="185" r="5" stroke="currentColor" stroke-width="0.7" />
	<circle cx="404" cy="185" r="5" stroke="currentColor" stroke-width="0.7" />
	<path d="M382 112V83M371 83H393M375 75H389" stroke="currentColor" stroke-width="0.9" />
	<path
		d="M382 81C368 88 368 98 382 105M382 81C396 88 396 98 382 105"
		stroke="currentColor"
		stroke-width="0.65"
	/>
	<text
		x="382"
		y="58"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">LTE / GNSS</text
	>

	<path
		d="M140 193H182M308 193H350M140 200H182M308 200H350"
		stroke="currentColor"
		stroke-width="0.6"
		stroke-dasharray="4 2"
	/>
	<path d="M53 286H414" stroke="currentColor" stroke-width="0.7" />
	<text
		x="233"
		y="298"
		fill="currentColor"
		font-family="JetBrains Mono"
		font-size="7"
		text-anchor="middle">POWER · DATA · ACCESSIBLE AUDIO</text
	>
</svg>
