<script lang="ts">
	import { Button } from '@yesid/ui/button';
	import type { Snippet } from 'svelte';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import MapPinnedIcon from '@lucide/svelte/icons/map-pinned';
	import RouteIcon from '@lucide/svelte/icons/route';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import UsersRoundIcon from '@lucide/svelte/icons/users-round';

	export type MapFilterGroupKind = 'markers' | 'alerts' | 'active' | 'status' | 'crowding';

	interface Props {
		kind: MapFilterGroupKind;
		label: string;
		open: boolean;
		presentation: 'desktop' | 'drawer';
		count?: number;
		/** One line of guidance shown above the group's rows. */
		help?: string;
		ontoggle: () => void;
		children?: Snippet;
	}

	let { kind, label, open, presentation, count = 0, help, ontoggle, children }: Props = $props();
	const contentId = $derived(`map-filter-group-${presentation}-${kind}`);
</script>

<fieldset class="mf-group" data-filter-group={kind} aria-label={label}>
	<Button
		variant="ghost"
		size="sm"
		type="button"
		class="mf-group-trigger"
		aria-expanded={open}
		aria-controls={contentId}
		onclick={ontoggle}
	>
		<span class="mf-group-badge" data-icon={kind} aria-hidden="true">
			{#if kind === 'markers'}
				<MapPinnedIcon size={14} strokeWidth={2.25} />
			{:else if kind === 'alerts'}
				<TriangleAlertIcon size={14} strokeWidth={2.25} />
			{:else if kind === 'active'}
				<RouteIcon size={14} strokeWidth={2.25} />
			{:else if kind === 'status'}
				<GaugeIcon size={14} strokeWidth={2.25} />
			{:else}
				<UsersRoundIcon size={14} strokeWidth={2.25} />
			{/if}
		</span>
		<span class="mf-group-label">{label}</span>
		{#if count > 0}
			<span class="mf-group-count">{count}</span>
		{/if}
	</Button>
	<div id={contentId} class="mf-group-content" hidden={!open}>
		{#if help}<p class="mf-group-help">{help}</p>{/if}
		{@render children?.()}
	</div>
</fieldset>

<style>
	:global(.mf-group) {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	:global(.mf-group-trigger) {
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 44px;
		gap: 0.5rem;
		padding: calc(var(--spacing) * 2) 0;
		font: inherit;
		color: var(--foreground);
		text-align: left;
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	:global(.mf-group-trigger:hover),
	:global(.mf-group-trigger:focus-visible) {
		background: var(--muted);
	}

	:global(.mf-group-badge) {
		display: inline-grid;
		place-items: center;
		width: 1rem;
		height: 1.5rem;
		flex: none;
		color: var(--primary);
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
	}

	:global(.mf-group-label) {
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
	}

	:global(.mf-group-count) {
		display: inline-grid;
		min-width: 1.25rem;
		height: 1.25rem;
		place-items: center;
		margin-left: auto;
		padding: 0 0.25rem;
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		color: var(--primary-foreground);
		background: var(--primary);
		border-radius: var(--radius-sm);
	}

	:global(.mf-group-content) {
		min-width: 0;
	}
	:global(.mf-group-help) {
		margin: 0 0 0.375rem;
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	:global(.mf-group-trigger:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
</style>
