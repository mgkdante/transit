<script lang="ts">
	import { onMount } from 'svelte';
	import { getLocalizeHref } from '#lib/i18n/index.ts';
	import type { Locale } from '#lib/i18n/index.ts';
	import type { MapSelectionSession } from './mapSelectionSession.svelte';
	import { MAP_SELECTION_DETAIL_COPY } from './mapSelectionDetail.copy';
	import { detailActions } from './mapSelectionDetail.logic';
	import { acceptsItemArrow } from './selectionSession/detailNavigation';
	let {
		locale,
		session,
		desktop,
		onfocus,
	}: { locale: Locale; session: MapSelectionSession; desktop: boolean; onfocus?: () => void } =
		$props();
	const localizeHref = getLocalizeHref();
	const t = $derived(MAP_SELECTION_DETAIL_COPY[locale]);
	const action = $derived(session.detail ? detailActions(session.detail, locale) : null);
	let root: HTMLElement;
	let width = $state(0);
	let lastSurfaceKey: string | undefined;
	let active = $state('overview');
	let sections = $state<{ key: string; label: string; element: HTMLElement }[]>([]);
	function surface() {
		return root?.closest('[data-slot="right-panel"], [data-slot="bottom-sheet"]');
	}
	function step(delta: -1 | 1) {
		const next = delta === -1 ? session.adjacent.previous : session.adjacent.next;
		if (next) {
			session.select(next, 'detail');
			onfocus?.();
		}
	}
	function scrollToSection(element: HTMLElement) {
		const scroller = element.closest(
			'[data-slot="bottom-sheet-body"], [data-slot="scroll-area-viewport"]',
		);
		if (scroller)
			scroller.scrollTop +=
				element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
	}
	$effect(() => {
		const key = session.surfaceKey;
		void session.detail;
		void width;
		const copy = t;
		queueMicrotask(() => {
			if (!key || !surface()) return;
			const groups = [
				{ key: 'overview', label: copy.overview, selector: '[data-slot="detail-status-band"]' },
				{
					key: 'stops',
					label: copy.stops,
					selector: '[data-slot="detail-next-stops"], [data-slot="detail-stops"]',
				},
				{
					key: 'schedule',
					label: copy.schedule,
					selector: '[data-slot="detail-departures"], [data-slot="detail-route-times"]',
				},
				{ key: 'alerts', label: copy.alerts, selector: '.map-alerts' },
			];
			sections = groups.flatMap((group) => {
				const element = surface()?.querySelector<HTMLElement>(group.selector);
				return element && getComputedStyle(element).display !== 'none'
					? [{ ...group, element }]
					: [];
			});
			sections.sort((a, b) =>
				a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
			);
			if (lastSurfaceKey !== key) active = 'overview';
			lastSurfaceKey = key;
		});
	});
	onMount(() => {
		function key(event: KeyboardEvent) {
			if (!desktop || !surface()?.contains(event.target as Node) || !acceptsItemArrow(event))
				return;
			const delta = event.key === 'ArrowLeft' ? -1 : 1;
			if (delta === -1 ? session.adjacent.previous : session.adjacent.next) {
				event.preventDefault();
				step(delta);
			}
		}
		function scroll() {
			const top = root.getBoundingClientRect().bottom + 24;
			const viewport = surface()?.querySelector<HTMLElement>(
				'[data-slot="bottom-sheet-body"], [data-slot="scroll-area-viewport"]',
			);
			if (
				viewport &&
				viewport.scrollHeight > viewport.clientHeight &&
				viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2
			) {
				active = sections.at(-1)?.key ?? 'overview';
				return;
			}
			active =
				sections.filter((s) => s.element.getBoundingClientRect().top <= top).at(-1)?.key ??
				'overview';
		}
		document.addEventListener('keydown', key);
		document.addEventListener('scroll', scroll, true);
		return () => {
			document.removeEventListener('keydown', key);
			document.removeEventListener('scroll', scroll, true);
		};
	});
</script>

<nav bind:this={root} bind:clientWidth={width} aria-label={t.navigation} class="detail-navigation">
	<div class="detail-navigation-actions">
		<button
			type="button"
			aria-label={t.back}
			title={t.back}
			disabled={!session.stack.length}
			onclick={() => {
				session.back();
				onfocus?.();
			}}>←</button
		>
		<button
			type="button"
			aria-label={t.forward}
			title={t.forward}
			disabled={!session.canGoForward}
			onclick={() => {
				session.forward();
				onfocus?.();
			}}>→</button
		>
		{#if session.selected?.kind !== 'route'}
			<button
				type="button"
				aria-label={session.selected?.kind === 'vehicle' ? t.previousVehicle : t.previousStop}
				disabled={!session.adjacent.previous}
				onclick={() => step(-1)}>‹</button
			>
			<button
				type="button"
				aria-label={session.selected?.kind === 'vehicle' ? t.nextVehicle : t.nextStopItem}
				disabled={!session.adjacent.next}
				onclick={() => step(1)}>›</button
			>
		{/if}
		{#if action}<a
				href={localizeHref(action.href, locale)}
				aria-label={action.label}
				title={action.label}>↗</a
			>{/if}
	</div>
	<div class="detail-section-links" aria-label={t.navigation}>
		{#each sections as section (section.key)}
			<button
				type="button"
				aria-current={active === section.key ? 'location' : undefined}
				onclick={() => scrollToSection(section.element)}>{section.label}</button
			>
		{/each}
	</div>
</nav>

<style>
	.detail-navigation {
		min-width: 0;
	}
	.detail-navigation-actions,
	.detail-section-links {
		display: flex;
		gap: 0.25rem;
	}
	.detail-navigation-actions {
		justify-content: space-between;
	}
	.detail-navigation button,
	.detail-navigation a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		padding: 0.5rem;
		border-radius: var(--radius-sm);
	}
	.detail-navigation a {
		margin-left: auto;
	}
	.detail-navigation button:disabled {
		opacity: 0.4;
	}
	.detail-navigation button:focus-visible,
	.detail-navigation a:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	.detail-section-links {
		overflow-x: auto;
		font-size: var(--text-caption);
	}
	.detail-section-links button {
		flex: none;
		white-space: nowrap;
	}
	.detail-section-links button[aria-current] {
		background: var(--secondary);
		color: var(--foreground);
		box-shadow: inset 0 -2px var(--primary);
	}
	@media (max-width: 767px) {
		.detail-section-links button {
			border: 1px solid var(--border);
			border-radius: var(--radius-pill);
		}
	}
</style>
