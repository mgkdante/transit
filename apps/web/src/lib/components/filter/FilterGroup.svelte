<script lang="ts">
	import { untrack } from 'svelte';
	import { ChevronToggle } from '@yesid/ui/brand';
	import { getLocale, type Locale } from '$lib/i18n';
	import { ToggleGroup, ToggleGroupItem } from '@yesid/ui/toggle-group';
	import SegmentedChoice from '$lib/components/surface/SegmentedChoice.svelte';
	import { persisted } from '$lib/stores/persisted.svelte';

	const locale: Locale = getLocale();

	const defaultAllLabel: Record<Locale, string> = { en: 'All', fr: 'Tous' };

	let {
		label,
		items,
		activeKey = null,
		allowDeselect = true,
		collapsible = false,
		startOpen = true,
		persistKey = undefined,
		allLabel = defaultAllLabel,
		density = 'compact',
		variant = 'default',
		onSelect,
		testIdPrefix = undefined,
	}: {
		label: string;
		items: readonly { key: string; label: string }[];
		activeKey?: string | null;
		allowDeselect?: boolean;
		collapsible?: boolean;
		startOpen?: boolean;
		persistKey?: string;
		allLabel?: Record<Locale, string>;
		density?: 'compact' | 'spacious';
		variant?: 'default' | 'joined-grid';
		onSelect: (key: string | null) => void;
		testIdPrefix?: string | undefined;
	} = $props();
	const uid = $props.id();
	const collapseId = `filter-group-${uid}`;
	const labelId = `${collapseId}-label`;

	const persistedOpen = untrack(() => (persistKey ? persisted(persistKey, startOpen) : null));
	let localOpen = $state(untrack(() => startOpen));
	const isOpen = $derived(persistedOpen ? persistedOpen.value : localOpen);
	function toggleOpen(): void {
		if (persistedOpen) persistedOpen.value = !persistedOpen.value;
		else localOpen = !localOpen;
	}

	const groupValue = $derived(activeKey ?? '__all__');
	const joinedOptions = $derived([
		{ key: '__all__', label: allLabel[locale] },
		...items.map((item) => ({
			...item,
			testId: testIdPrefix ? `${testIdPrefix}-${item.key}` : undefined,
		})),
	]);

	function handleValueChange(value: string) {
		if (!value) {
			if (allowDeselect) onSelect(null);
			return;
		}
		onSelect(value === '__all__' ? null : value);
	}

	function handleJoinedSelection(value: string): void {
		if (allowDeselect && activeKey !== null && value === activeKey) {
			onSelect(null);
			return;
		}
		handleValueChange(value);
	}
</script>

<div data-density={density} data-variant={variant}>
	{#if collapsible}
		<button
			type="button"
			id={labelId}
			class="tap-press flex w-full items-center justify-between label-section text-sm font-semibold py-2.5 min-h-11 transition-colors hover:text-[var(--foreground)] active:text-[var(--foreground)]"
			aria-expanded={isOpen}
			aria-controls={collapseId}
			onclick={toggleOpen}
		>
			{label}
			<ChevronToggle open={isOpen} size="sm" direction="down" />
		</button>
	{:else}
		<div id={labelId} class="label-section text-sm font-semibold">
			{label}
		</div>
	{/if}

	<div
		id={collapseId}
		class="filter-collapse"
		class:filter-open={!collapsible || isOpen}
		inert={collapsible && !isOpen}
		aria-hidden={collapsible && !isOpen ? 'true' : undefined}
	>
		<div class="filter-collapse-inner">
			{#if variant === 'joined-grid'}
				<SegmentedChoice
					options={joinedOptions}
					value={groupValue}
					{label}
					onSelect={handleJoinedSelection}
					variant="joined-grid"
					class="mt-2"
				/>
			{:else}
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
								{allLabel[locale]}
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
			{/if}
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
	.filter-collapse.filter-open {
		grid-template-rows: 1fr;
	}
	.filter-collapse-inner {
		overflow: hidden;
		min-height: 0;
	}
</style>
