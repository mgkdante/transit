<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import PanelRightCloseIcon from '@lucide/svelte/icons/panel-right-close';
	import PanelRightOpenIcon from '@lucide/svelte/icons/panel-right-open';
	import XIcon from '@lucide/svelte/icons/x';
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, getLocale } from '$lib/i18n';
	import { ScrollArea } from '@yesid/ui/scroll-area';
	import { SectionLabel } from '@yesid/ui/brand';

	interface RightPanelProps {
		locale?: Locale;
		title?: string;
		headingId?: string;
		identity?: Snippet;
		surfaceKey?: string;
		dismissible?: boolean;
		canGoBack?: boolean;
		onback?: () => void;
		onclose?: () => void;
		children?: Snippet;
		footer?: Snippet;
		resizable?: boolean;
		collapsed?: boolean;
		ontogglecollapse?: () => void;
		class?: string;
	}

	let {
		locale: localeProp,
		title,
		headingId,
		identity,
		surfaceKey = 'empty',
		dismissible = true,
		canGoBack = false,
		onback,
		onclose,
		children,
		footer,
		resizable = false,
		collapsed = $bindable(false),
		ontogglecollapse,
		class: className,
	}: RightPanelProps = $props();

	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);

	const defaultTitle = $derived(locale === 'fr' ? 'Détails' : 'Details');
	const emptyLabel = $derived(
		locale === 'fr' ? 'Sélectionnez un élément' : 'Select something to inspect',
	);
	const backAria = $derived(locale === 'fr' ? 'Retour' : 'Back');
	const closeAria = $derived(locale === 'fr' ? 'Fermer le volet' : 'Close panel');
	const collapseAria = $derived(locale === 'fr' ? 'Réduire le volet' : 'Collapse panel');
	const expandAria = $derived(locale === 'fr' ? 'Ouvrir le volet' : 'Expand panel');
	const panelHeadingId = $derived(headingId ?? `right-panel-${surfaceKey}-heading`);
	const panelBodyId = $derived(`${panelHeadingId}-body`);
	let firstSurfaceKey = $state<string>();
	let hasReentered = $state(false);

	$effect(() => {
		if (firstSurfaceKey === undefined) {
			firstSurfaceKey = surfaceKey;
		} else if (surfaceKey !== firstSurfaceKey) {
			hasReentered = true;
		}
	});

	function toggleCollapsed(): void {
		if (ontogglecollapse) {
			ontogglecollapse();
			return;
		}
		collapsed = !collapsed;
	}
</script>

<aside
	class={cn('right-panel flex h-full shrink-0 flex-col border-l border-border bg-card', className)}
	aria-labelledby={panelHeadingId}
	tabindex="-1"
	data-slot="right-panel"
	data-open={collapsed ? 'false' : 'true'}
	data-resizable={resizable ? 'true' : undefined}
	data-surface-key={surfaceKey}
>
	<div class="flex h-14 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
		<button
			type="button"
			class="tap-press -ml-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			aria-label={collapsed ? expandAria : collapseAria}
			aria-expanded={!collapsed}
			aria-controls={panelBodyId}
			onclick={toggleCollapsed}
			data-slot="right-panel-toggle"
		>
			{#if collapsed}
				<PanelRightOpenIcon size={15} strokeWidth={2.3} aria-hidden="true" />
			{:else}
				<PanelRightCloseIcon size={15} strokeWidth={2.3} aria-hidden="true" />
			{/if}
		</button>

		{#if canGoBack && !collapsed}
			<button
				type="button"
				class="tap-press inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-label={backAria}
				onclick={() => onback?.()}
				data-slot="right-panel-back"
			>
				<ArrowLeftIcon size={14} strokeWidth={2.3} aria-hidden="true" />
			</button>
		{/if}

		<h2
			id={panelHeadingId}
			class={cn('right-panel-identity m-0 min-w-0 flex-1', collapsed && 'sr-only')}
		>
			{#if identity}
				{@render identity()}
			{:else}
				<SectionLabel text={title ?? defaultTitle} variant="station" />
			{/if}
		</h2>

		{#if dismissible}
			<button
				type="button"
				class={cn(
					'tap-press -mr-1 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
					collapsed && 'sr-only',
				)}
				aria-label={closeAria}
				aria-hidden={collapsed ? 'true' : undefined}
				tabindex={collapsed ? -1 : undefined}
				onclick={() => onclose?.()}
				data-slot="right-panel-close"
			>
				<XIcon size={14} strokeWidth={2.3} aria-hidden="true" />
			</button>
		{/if}
	</div>

	{#if !collapsed}
		<ScrollArea id={panelBodyId} class="min-h-0 flex-1" data-slot="right-panel-body">
			{#key surfaceKey}
				<div class={cn('right-panel-body-inner p-4', hasReentered && 'swap-volet')}>
					{#if children}
						{@render children()}
					{:else}
						<p class="px-1 py-8 text-center text-caption text-muted-foreground">
							{emptyLabel}
						</p>
					{/if}
				</div>
			{/key}
		</ScrollArea>
	{:else}
		<div id={panelBodyId} hidden data-slot="right-panel-body"></div>
	{/if}

	{#if footer && !collapsed}
		<div
			class="empty:hidden shrink-0 border-t border-border-subtle bg-card px-4 py-3"
			data-slot="right-panel-footer"
		>
			{@render footer()}
		</div>
	{/if}
</aside>

<style>
	.right-panel {
		width: var(--size-detail-panel);
		overflow: hidden;
		box-shadow: var(--shadow-detail-panel);
		container: right-panel / inline-size;
	}
	.right-panel-identity {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		letter-spacing: var(--tracking-eyebrow, 0.1em);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.right-panel-identity::before {
		width: 0.125rem;
		height: 0.75rem;
		flex: none;
		background: var(--primary);
		content: '';
	}

	.right-panel[data-open='false'] {
		width: var(--size-detail-rail);
	}

	.right-panel[data-resizable='true'] {
		width: 100%;
		min-width: 0;
	}
	.right-panel[data-resizable='true'][data-open='false'] {
		width: var(--size-detail-rail);
		min-width: var(--size-detail-rail);
	}

	.right-panel-body-inner {
		scrollbar-gutter: stable;
	}
	.swap-volet {
		animation: volet-in var(--duration-normal) var(--ease-out) both;
	}

	@keyframes volet-in {
		from {
			opacity: 0;
			transform: translateX(8px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.swap-volet {
			animation: none;
		}
	}
</style>
