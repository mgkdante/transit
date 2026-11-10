<script lang="ts">
	import { Button } from '@yesid/ui/button';
	import { Tabs, TabsContent } from '@yesid/ui/tabs';
	import TransitTabList from '#lib/components/shared/TransitTabList.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { onMount } from 'svelte';
	import type { Locale } from '#lib/i18n/index.ts';
	import type { MapSelectionSession } from './mapSelectionSession.svelte';
	import { MAP_SELECTION_DETAIL_COPY } from './mapSelectionDetail.copy';
	import { acceptsItemArrow } from './selectionSession/detailNavigation';
	let {
		locale,
		session,
		desktop,
		onfocus,
	}: { locale: Locale; session: MapSelectionSession; desktop: boolean; onfocus?: () => void } =
		$props();
	const t = $derived(MAP_SELECTION_DETAIL_COPY[locale]);
	const vehicleKind = $derived(session.selected?.kind === 'vehicle');
	// Routes have no siblings; a lone item has nothing to step through.
	const stepper = $derived(
		session.selected?.kind !== 'route' &&
			(session.adjacent.previous != null || session.adjacent.next != null),
	);
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
		<div class="detail-control-group" role="group" aria-label={t.history}>
			<Button
				variant="ghost"
				size="icon-tap"
				type="button"
				aria-label={t.back}
				title={t.back}
				disabled={!session.stack.length}
				onclick={() => {
					session.back();
					onfocus?.();
				}}><ArrowLeftIcon size={16} strokeWidth={2.25} aria-hidden="true" /></Button
			>
			<Button
				variant="ghost"
				size="icon-tap"
				type="button"
				aria-label={t.forward}
				title={t.forward}
				disabled={!session.canGoForward}
				onclick={() => {
					session.forward();
					onfocus?.();
				}}><ArrowRightIcon size={16} strokeWidth={2.25} aria-hidden="true" /></Button
			>
		</div>
		{#if stepper}
			<div
				class="detail-control-group detail-stepper"
				role="group"
				aria-label={vehicleKind ? t.vehicleSiblings : t.stopSiblings}
			>
				<Button
					variant="ghost"
					size="icon-tap"
					type="button"
					aria-label={vehicleKind ? t.previousVehicle : t.previousStop}
					title={vehicleKind ? t.previousVehicle : t.previousStop}
					disabled={!session.adjacent.previous}
					onclick={() => step(-1)}
					><ChevronLeftIcon size={16} strokeWidth={2.25} aria-hidden="true" /></Button
				>
				{#if desktop && session.adjacent.position != null}<span
						class="detail-stepper-position"
						title={vehicleKind ? t.vehicleSiblings : t.stopSiblings}
						>{t.position(session.adjacent.position, session.adjacent.total)}</span
					>{/if}
				<Button
					variant="ghost"
					size="icon-tap"
					type="button"
					aria-label={vehicleKind ? t.nextVehicle : t.nextStopItem}
					title={vehicleKind ? t.nextVehicle : t.nextStopItem}
					disabled={!session.adjacent.next}
					onclick={() => step(1)}
					><ChevronRightIcon size={16} strokeWidth={2.25} aria-hidden="true" /></Button
				>
			</div>
		{/if}
	</div>
	<div class="detail-section-links">
		<Tabs
			class="detail-section-tabs"
			value={active}
			onValueChange={(key) => {
				active = key;
				const section = sections.find((s) => s.key === key);
				if (section) scrollToSection(section.element);
			}}
		>
			<TransitTabList
				tabs={sections}
				compact={!desktop}
				label={t.sections}
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
	/* Desktop: a toolbar row, then the station band edge to edge. */
	:global(.detail-navigation) {
		display: grid;
		min-width: 0;
	}
	:global(.detail-navigation-actions) {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
		padding: 0.375rem 1rem;
	}
	/* One hairline frame per group: what moves together reads together. */
	:global(.detail-control-group) {
		display: inline-flex;
		flex: none;
		align-items: center;
		border-radius: var(--radius-md);
		box-shadow: inset 0 0 0 1px var(--border-subtle);
	}
	:global(.detail-control-group > [data-slot='button']) {
		border-radius: 0;
		color: var(--muted-foreground);
	}
	:global(.detail-control-group > [data-slot='button']:first-child) {
		border-start-start-radius: var(--radius-md);
		border-end-start-radius: var(--radius-md);
	}
	:global(.detail-control-group > [data-slot='button']:last-child) {
		border-start-end-radius: var(--radius-md);
		border-end-end-radius: var(--radius-md);
	}
	:global(.detail-control-group > * + *) {
		box-shadow: inset 1px 0 0 var(--border-subtle);
	}
	:global(.detail-control-group > [data-slot='button']:not(:disabled):hover) {
		color: var(--foreground);
		background: var(--muted);
	}
	:global(.detail-control-group > [data-slot='button']:disabled) {
		opacity: 0.35;
	}
	:global(.detail-control-group > [data-slot='button']:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	:global(.detail-stepper) {
		margin-inline-start: auto;
	}
	:global(.detail-stepper-position) {
		align-self: stretch;
		display: inline-grid;
		place-items: center;
		min-width: 4.5rem;
		padding-inline: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
		white-space: nowrap;
	}
	:global(.detail-section-links) {
		min-width: 0;
	}
	:global(.detail-section-tabs) {
		display: block;
		width: 100%;
		min-width: 0;
	}
	:global(.detail-section-links .station-tab) {
		font-size: var(--text-caption);
	}
	/* Phone: one 44 px row so the header still fits the 168 px peek detent;
	   the band bleeds to the sheet edge so it reads as signage, not a block. */
	.detail-navigation.mobile {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.mobile .detail-navigation-actions {
		flex: none;
		gap: 0.5rem;
		padding: 0;
	}
	.mobile .detail-stepper {
		margin-inline-start: 0;
	}
	.mobile .detail-section-links {
		flex: 1 1 auto;
		align-self: stretch;
		display: flex;
		margin-inline-end: -1rem;
		background: var(--primary);
	}
</style>
