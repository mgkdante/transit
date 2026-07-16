<!--
  SegmentedChoice — controlled, copy-free single-select radio engine.

  Callers own semantic keys and state. This component owns the shared radio
  affordance, roving focus, arrow navigation, pointer labels, motion, and the
  adaptive joined frame used by time and filter controls.
-->
<script module lang="ts">
	export type SegmentedChoiceVariant = 'default' | 'joined-grid';

	export interface SegmentedChoiceOption<K extends string = string> {
		readonly key: K;
		/** Full visible and accessible label. */
		readonly label: string;
		/** Optional shorter visible label; the full label remains the accessible name. */
		readonly compactLabel?: string;
		readonly disabled?: boolean;
		readonly describedById?: string;
		readonly title?: string;
		readonly testId?: string;
	}

	export interface SegmentedChoiceProps<K extends string = string> {
		readonly options: readonly SegmentedChoiceOption<K>[];
		readonly value: K;
		readonly label: string;
		readonly onSelect: (key: K) => void;
		readonly variant?: SegmentedChoiceVariant;
		/** Consumer-facing variant marker when its public vocabulary differs. */
		readonly dataVariant?: string;
		readonly dataSlot?: string;
		readonly class?: string;
	}
</script>

<script lang="ts" generics="K extends string = string">
	import { cn } from '$lib/utils';
	import { boop, pressBounce } from '@yesid/motion';

	let {
		options,
		value,
		label,
		onSelect,
		variant = 'default',
		dataVariant = variant,
		dataSlot = 'segmented-choice',
		class: className,
	}: SegmentedChoiceProps<K> = $props();

	const refs: (HTMLButtonElement | null)[] = $state([]);
	const selectedIndex = $derived(options.findIndex((option) => option.key === value));
	const checkedIndex = $derived(
		selectedIndex >= 0
			? selectedIndex
			: Math.max(
					0,
					options.findIndex((option) => !option.disabled),
				),
	);

	function gridCell(index: number): string {
		if (variant !== 'joined-grid') return '';
		if (options.length === 3 && index === 2) return '2:1-2';
		return `${Math.floor(index / 2) + 1}:${(index % 2) + 1}`;
	}

	function pointerTitle(option: SegmentedChoiceOption<K>): string | undefined {
		return option.title ?? (option.compactLabel ? option.label : undefined);
	}

	function pick(option: SegmentedChoiceOption<K>): void {
		if (option.disabled) return;
		onSelect(option.key);
	}

	function onkeydown(event: KeyboardEvent): void {
		const direction =
			event.key === 'ArrowRight' || event.key === 'ArrowDown'
				? 1
				: event.key === 'ArrowLeft' || event.key === 'ArrowUp'
					? -1
					: 0;
		if (direction === 0 || options.length === 0) return;

		for (let step = 1; step <= options.length; step += 1) {
			const next =
				(((checkedIndex + direction * step) % options.length) + options.length) % options.length;
			const option = options[next];
			if (!option.disabled) {
				event.preventDefault();
				onSelect(option.key);
				refs[next]?.focus();
				return;
			}
		}
	}
</script>

<div
	class={cn(
		'segmented-choice',
		variant === 'joined-grid' && 'segmented-choice--joined-grid',
		className,
	)}
	role="radiogroup"
	aria-label={label}
	data-slot={dataSlot}
	data-variant={dataVariant}
	data-segment-count={options.length}
>
	{#each options as option, index (option.key)}
		<button
			bind:this={refs[index]}
			type="button"
			role="radio"
			class={cn(
				'tap-press segmented-choice-segment',
				value === option.key && 'segmented-choice-segment--active',
			)}
			aria-checked={value === option.key}
			aria-describedby={option.describedById}
			aria-label={option.compactLabel ? option.label : undefined}
			title={pointerTitle(option)}
			disabled={option.disabled}
			tabindex={index === checkedIndex ? 0 : -1}
			data-grid-cell={gridCell(index) || undefined}
			data-testid={option.testId}
			onclick={() => pick(option)}
			use:boop={{ scale: 1.04 }}
			use:pressBounce
			{onkeydown}
		>
			{option.compactLabel ?? option.label}
		</button>
	{/each}
</div>

<style>
	.segmented-choice {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background-color: var(--card);
	}
	.segmented-choice--joined-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		grid-auto-rows: minmax(52px, auto);
		width: 100%;
		min-width: 0;
		gap: 0;
		padding: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--primary) 6%, var(--card));
	}
	.segmented-choice--joined-grid .segmented-choice-segment {
		width: 100%;
		min-width: 0;
		min-height: 52px;
		padding-inline: 0.375rem;
		border: 0;
		border-radius: 0;
		scale: 1 !important;
		transform: none !important;
		white-space: nowrap;
		overflow-wrap: normal;
		word-break: keep-all;
	}
	.segmented-choice--joined-grid .segmented-choice-segment:nth-child(even) {
		border-inline-start: 1px solid var(--border);
	}
	.segmented-choice--joined-grid .segmented-choice-segment:nth-child(n + 3) {
		border-block-start: 1px solid var(--border);
	}
	.segmented-choice--joined-grid[data-segment-count='3'] .segmented-choice-segment:last-child {
		grid-column: 1 / -1;
	}
	.segmented-choice--joined-grid .segmented-choice-segment--active {
		box-shadow: inset 0 1px 0 var(--edge-highlight);
	}
	.segmented-choice--joined-grid .segmented-choice-segment:focus-visible {
		outline-offset: -3px;
	}
	.segmented-choice-segment {
		appearance: none;
		border: 0;
		background: transparent;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0.375rem 0.8rem;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
	}
	.segmented-choice-segment:hover:not(:disabled) {
		color: var(--foreground);
	}
	.segmented-choice-segment:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.segmented-choice-segment--active {
		background-color: var(--primary);
		color: var(--primary-foreground);
	}
	.segmented-choice-segment:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.segmented-choice-segment {
			transition: none;
		}
	}
</style>
