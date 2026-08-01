<script lang="ts">
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import MapPinnedIcon from '@lucide/svelte/icons/map-pinned';
	import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open';
	import RouteIcon from '@lucide/svelte/icons/route';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import UsersRoundIcon from '@lucide/svelte/icons/users-round';
	import WavesIcon from '@lucide/svelte/icons/waves';
	import XIcon from '@lucide/svelte/icons/x';
	import type { MapCopy } from './map.copy';
	import type { MapFilterGroupKind } from './MapFilterGroup.svelte';

	type MapFilterRailGroup = 'motion' | MapFilterGroupKind;

	interface Props {
		copy: MapCopy;
		activeCount: number;
		hasFilters: boolean;
		controlsId: string;
		onexpand: () => void;
		onactivate: (group: MapFilterRailGroup) => void;
		onclear: () => void;
	}

	let { copy, activeCount, hasFilters, controlsId, onexpand, onactivate, onclear }: Props =
		$props();
</script>

<div class="mf-rail-layer" data-testid="map-filter-rail">
	<button
		type="button"
		class="mf-rail-expand"
		aria-expanded="false"
		aria-controls={controlsId}
		aria-label={copy.controlsExpand}
		onclick={onexpand}
	>
		<PanelLeftOpenIcon size={16} strokeWidth={2.25} aria-hidden="true" />
	</button>

	<button
		type="button"
		class="mf-rail-glyph"
		aria-label={copy.motion.label}
		onclick={() => onactivate('motion')}
	>
		<WavesIcon size={16} strokeWidth={2.25} aria-hidden="true" />
		<span class="mf-rail-abbr">{copy.rail.motion}</span>
	</button>
	<button
		type="button"
		class="mf-rail-glyph"
		aria-label={copy.legendTitle}
		onclick={() => onactivate('markers')}
	>
		<MapPinnedIcon size={16} strokeWidth={2.25} aria-hidden="true" />
		<span class="mf-rail-abbr">{copy.rail.markers}</span>
	</button>
	<button
		type="button"
		class="mf-rail-glyph"
		aria-label={copy.modeAlerts}
		onclick={() => onactivate('alerts')}
	>
		<TriangleAlertIcon size={16} strokeWidth={2.25} aria-hidden="true" />
		<span class="mf-rail-abbr">{copy.rail.alerts}</span>
	</button>
	<button
		type="button"
		class="mf-rail-glyph"
		aria-label={activeCount > 0 ? `${copy.activeTitle} ${activeCount}` : copy.activeTitle}
		onclick={() => onactivate('active')}
	>
		<RouteIcon size={16} strokeWidth={2.25} aria-hidden="true" />
		<span class="mf-rail-abbr">{copy.rail.active}</span>
		{#if activeCount > 0}
			<span class="mf-rail-count">{activeCount}</span>
		{/if}
	</button>
	<button
		type="button"
		class="mf-rail-glyph"
		aria-label={copy.modeStatus}
		onclick={() => onactivate('status')}
	>
		<GaugeIcon size={16} strokeWidth={2.25} aria-hidden="true" />
		<span class="mf-rail-abbr">{copy.rail.status}</span>
	</button>
	<button
		type="button"
		class="mf-rail-glyph"
		aria-label={copy.modeOccupancy}
		onclick={() => onactivate('crowding')}
	>
		<UsersRoundIcon size={16} strokeWidth={2.25} aria-hidden="true" />
		<span class="mf-rail-abbr">{copy.rail.crowding}</span>
	</button>

	{#if hasFilters}
		<button type="button" class="mf-rail-clear" aria-label={copy.filterClear} onclick={onclear}>
			<XIcon size={16} strokeWidth={2.25} aria-hidden="true" />
			<span>{copy.filterClear}</span>
		</button>
	{/if}
</div>

<style>
	.mf-rail-layer {
		position: absolute;
		inset: 0;
		display: grid;
		align-content: start;
		gap: 0.375rem;
		padding: 0.375rem;
	}

	.mf-rail-expand,
	.mf-rail-glyph,
	.mf-rail-clear {
		display: grid;
		place-items: center;
		width: 100%;
		min-height: 44px;
		padding: 0.25rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		line-height: 1;
		color: var(--foreground);
		background: transparent;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.mf-rail-expand:hover,
	.mf-rail-expand:focus-visible,
	.mf-rail-glyph:hover,
	.mf-rail-glyph:focus-visible,
	.mf-rail-clear:hover,
	.mf-rail-clear:focus-visible {
		color: var(--primary);
		border-color: color-mix(in srgb, var(--primary) 48%, var(--border) 52%);
		background: color-mix(in srgb, var(--primary) 10%, transparent);
	}

	.mf-rail-glyph {
		position: relative;
		min-height: 44px;
		gap: 0.125rem;
	}

	.mf-rail-abbr {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mf-rail-count {
		position: absolute;
		top: 0.125rem;
		right: 0.125rem;
		display: inline-grid;
		min-width: 1rem;
		height: 1rem;
		place-items: center;
		padding: 0 0.1875rem;
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		color: var(--primary-foreground);
		background: var(--primary);
		border-radius: var(--radius-pill);
	}

	.mf-rail-clear {
		gap: 0.125rem;
	}
</style>
