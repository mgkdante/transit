<script lang="ts">
	import { snapSize, stepSize, sizeText, LEFT_SIZES } from './panelSizes';
	import type { Locale } from '#lib/i18n/index.ts';
	let {
		locale,
		side,
		width,
		onchange,
	}: { locale: Locale; side: 'left'; width: number; onchange: (width: number) => void } = $props();
	let start: { x: number; width: number } | null = null;
	function down(event: PointerEvent) {
		if (event.button !== 0) return;
		start = { x: event.clientX, width };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault();
	}
	function up(event: PointerEvent) {
		if (!start) return;
		const next = snapSize(start.width + event.clientX - start.x, LEFT_SIZES);
		start = null;
		onchange(next);
	}
	function key(event: KeyboardEvent) {
		const next = stepSize(width, event.key, LEFT_SIZES, side);
		if (next === null) return;
		event.preventDefault();
		onchange(next);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="handle"
	role="separator"
	tabindex="0"
	aria-orientation="vertical"
	aria-label={locale === 'fr' ? 'Redimensionner les commandes' : 'Resize map controls'}
	aria-valuemin={56}
	aria-valuemax={300}
	aria-valuenow={width}
	aria-valuetext={sizeText(width, locale, side)}
	onkeydown={key}
	onpointerdown={down}
	onpointerup={up}
	onpointercancel={() => (start = null)}
	onlostpointercapture={() => (start = null)}
></div>

<style>
	.handle {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		width: 10px;
		cursor: col-resize;
		touch-action: none;
		z-index: 2;
	}
	.handle::after {
		content: '';
		position: absolute;
		right: 3px;
		top: 40%;
		height: 32px;
		width: 3px;
		border-radius: 2px;
		background: var(--primary);
	}
	.handle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
</style>
