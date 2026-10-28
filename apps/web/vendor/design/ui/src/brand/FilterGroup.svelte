<!--
  One single-choice filter: a label, an "All" reset and one button per item. Optionally
  collapsible, with its open state kept in `persisted(persistKey)`.
-->
<script lang="ts" module>
	export interface FilterGroupItem {
		key: string;
		label: string;
	}

	export interface FilterGroupProps {
		label: string;
		items: readonly FilterGroupItem[];
		/** `null` selects the "All" reset. */
		activeKey?: string | null;
		allLabel: string;
		/** Choosing the active item again clears the selection. */
		allowDeselect?: boolean;
		collapsible?: boolean;
		startOpen?: boolean;
		persistKey?: string;
		density?: 'compact' | 'spacious';
		onSelect: (key: string | null) => void;
		/** Each item button gets `data-testid="{testIdPrefix}-{key}"`. */
		testIdPrefix?: string;
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { ToggleGroup, ToggleGroupItem } from '../primitives/toggle-group/index.js';
	import { persisted } from '../state/persisted.svelte.js';
	import ChevronToggle from './ChevronToggle.svelte';

	let {
		label,
		items,
		activeKey = null,
		allLabel,
		allowDeselect = true,
		collapsible = false,
		startOpen = true,
		persistKey,
		density = 'compact',
		onSelect,
		testIdPrefix,
	}: FilterGroupProps = $props();
	const uid = $props.id();
	const collapseId = `filter-group-${uid}`;
	const labelId = `${collapseId}-label`;

	const persistedOpen = untrack(() => (persistKey ? persisted(persistKey, startOpen) : null));
	let localOpen = $state(untrack(() => startOpen));
	const isOpen = $derived(persistedOpen ? persistedOpen.value : localOpen);
	// The head boot script applies the stored choice to these marked elements before first paint.
	const persistedKey = $derived(collapsible ? persistKey : undefined);
	function toggleOpen(): void {
		if (persistedOpen) persistedOpen.value = !persistedOpen.value;
		else localOpen = !localOpen;
	}

	const groupValue = $derived(activeKey ?? '__all__');

	function handleValueChange(value: string) {
		if (!value) {
			if (allowDeselect) onSelect(null);
			return;
		}
		onSelect(value === '__all__' ? null : value);
	}
</script>

<div data-density={density}>
	{#if collapsible}
		<button
			type="button"
			id={labelId}
			class="tap-press flex w-full items-center justify-between label-section text-sm font-semibold py-2.5 min-h-11 transition-colors hover:text-[var(--foreground)] active:text-[var(--foreground)]"
			aria-expanded={isOpen}
			aria-controls={collapseId}
			data-persisted-key={persistedKey}
			onclick={toggleOpen}
		>
			{label}
			<ChevronToggle open={isOpen} size="sm" direction="down" data-persisted-key={persistedKey} />
		</button>
	{:else}
		<div id={labelId} class="label-section text-sm font-semibold">
			{label}
		</div>
	{/if}

	<div
		id={collapseId}
		class="filter-collapse"
		data-state={!collapsible || isOpen ? 'open' : 'closed'}
		data-persisted-body={persistedKey}
		inert={collapsible && !isOpen}
		aria-hidden={collapsible && !isOpen ? 'true' : undefined}
	>
		<div class="filter-collapse-inner">
			<ToggleGroup
				type="single"
				aria-labelledby={labelId}
				value={groupValue}
				onValueChange={handleValueChange}
				class="mt-2 flex w-full flex-col gap-1"
				orientation="vertical"
			>
				<ToggleGroupItem value="__all__">
					{#snippet child({ props })}
						<button
							{...props}
							class="tap-press filter-btn w-full rounded py-3 min-h-11 text-left transition-colors"
							class:px-2={density === 'compact'}
							class:text-sm={density === 'compact'}
							class:px-3={density === 'spacious'}
							class:text-base={density === 'spacious'}
							class:active={activeKey === null}
						>
							{allLabel}
						</button>
					{/snippet}
				</ToggleGroupItem>

				{#each items as item (item.key)}
					<ToggleGroupItem value={item.key}>
						{#snippet child({ props })}
							<button
								{...props}
								class="tap-press filter-btn w-full rounded border border-border py-3 min-h-11 text-left text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)] active:border-[var(--primary)] active:text-[var(--primary)]"
								class:px-2={density === 'compact'}
								class:text-sm={density === 'compact'}
								class:px-3={density === 'spacious'}
								class:text-base={density === 'spacious'}
								class:tag-active={activeKey === item.key}
								data-testid={testIdPrefix ? `${testIdPrefix}-${item.key}` : undefined}
							>
								{item.label}
							</button>
						{/snippet}
					</ToggleGroupItem>
				{/each}
			</ToggleGroup>
		</div>
	</div>
</div>

<style>
	.filter-btn {
		background: var(--card);
		border: 1px solid var(--border-subtle);
		box-shadow: inset 0 1px 0 var(--edge-highlight);
		color: var(--muted-foreground);
	}

	.active {
		background: var(--primary);
		border-color: var(--primary);
		color: var(--primary-foreground);
	}

	.filter-btn.tag-active {
		border-color: var(--accent-text);
		color: var(--accent-text);
		background: var(--accent-surface);
		position: relative;
	}
	.tag-active::after {
		content: '';
		position: absolute;
		right: 8px;
		top: 50%;
		transform: translateY(-50%);
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
	}

	.filter-collapse {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows var(--duration-slow) var(--ease-default);
	}
	.filter-collapse[data-state='open'] {
		grid-template-rows: 1fr;
	}
	.filter-collapse-inner {
		overflow: hidden;
		min-height: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.filter-collapse {
			transition: none;
		}
	}
</style>
