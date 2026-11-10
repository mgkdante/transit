<script lang="ts">
	import { Button } from '@yesid/ui/button';
	import { Tabs, TabsContent } from '@yesid/ui/tabs';
	import TransitTabList from '#lib/components/shared/TransitTabList.svelte';
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

<nav
	bind:this={root}
	bind:clientWidth={width}
	aria-label={t.navigation}
	class="detail-navigation"
	class:mobile={!desktop}
>
	<div class="detail-navigation-actions">
		<Button
			variant="ghost"
			size="sm"
			type="button"
			aria-label={t.back}
			title={t.back}
			disabled={!session.stack.length}
			onclick={() => {
				session.back();
				onfocus?.();
			}}>←</Button
		>
		<Button
			variant="ghost"
			size="sm"
			type="button"
			aria-label={t.forward}
			title={t.forward}
			disabled={!session.canGoForward}
			onclick={() => {
				session.forward();
				onfocus?.();
			}}>→</Button
		>
		{#if session.selected?.kind !== 'route'}
			<Button
				variant="ghost"
				size="sm"
				type="button"
				aria-label={session.selected?.kind === 'vehicle' ? t.previousVehicle : t.previousStop}
				disabled={!session.adjacent.previous}
				onclick={() => step(-1)}>‹</Button
			>
			<Button
				variant="ghost"
				size="sm"
				type="button"
				aria-label={session.selected?.kind === 'vehicle' ? t.nextVehicle : t.nextStopItem}
				disabled={!session.adjacent.next}
				onclick={() => step(1)}>›</Button
			>
		{/if}
		{#if action}<Button
				variant="ghost"
				size="sm"
				href={localizeHref(action.href, locale)}
				aria-label={action.label}
				title={action.label}>↗</Button
			>{/if}
	</div>
	<div class="detail-section-links">
		<Tabs
			value={active}
			onValueChange={(key) => {
				active = key;
				const section = sections.find((s) => s.key === key);
				if (section) scrollToSection(section.element);
			}}
		>
			<TransitTabList
				tabs={sections}
				compact
				label={t.navigation}
				onselect={(key) => {
					const section = sections.find((s) => s.key === key);
					if (section) scrollToSection(section.element);
				}}
			/>
			{#each sections as section (section.key)}<TabsContent value={section.key} class="sr-only"
					>{section.label}</TabsContent
				>{/each}
		</Tabs>
	</div>
</nav>

<style>
	:global(.detail-navigation) {
		min-width: 0;
	}
	/* Keep navigation in the fixed header even at the 168 px peek detent. */
	.detail-navigation.mobile {
		display: flex;
		gap: 0.5rem;
	}
	.mobile .detail-navigation-actions {
		flex: none;
	}
	.mobile .detail-section-links {
		min-width: 0;
	}
	:global(.detail-navigation-actions),
	:global(.detail-section-links) {
		display: flex;
		gap: 0.25rem;
	}
	:global(.detail-navigation-actions) {
		justify-content: flex-start;
	}
	:global(.detail-navigation-actions button),
	:global(.detail-navigation-actions a) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		padding: 0.5rem;
		border-radius: var(--radius-sm);
	}
	:global(.detail-navigation-actions a) {
		margin-left: auto;
	}
	:global(.detail-navigation button:disabled) {
		opacity: 0.4;
	}
	:global(.detail-navigation button:focus-visible),
	:global(.detail-navigation a:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	:global(.detail-section-links) {
		overflow-x: auto;
		font-size: var(--text-caption);
	}
</style>
