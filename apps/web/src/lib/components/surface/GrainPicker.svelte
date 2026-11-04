<script lang="ts">
	import { cn } from '#lib/utils/index.ts';
	import { SegmentedChoice, type SegmentedChoiceOption } from '@yesid/ui/brand';

	export type GrainPickerVariant = 'default' | 'time-grid';

	export interface GrainSegment<K extends string = string> {
		readonly key: K;
		readonly label: string;
		readonly compactLabel?: string;
		readonly available?: boolean;
		readonly describedById?: string;
		readonly title?: string;
		readonly hint?: string;
	}

	export interface GrainPickerProps<K extends string = string> {
		readonly segments: readonly GrainSegment<K>[];
		value: K;
		readonly label: string;
		readonly variant?: GrainPickerVariant;
		readonly class?: string;
		readonly onSelect?: (key: K) => void;
	}

	let {
		segments,
		value = $bindable(),
		label,
		variant = 'default',
		class: className,
		onSelect,
	}: GrainPickerProps = $props();
	const uid = $props.id();
	const describedSegments = $derived(
		segments.map((segment) =>
			segment.available === false && segment.title && !segment.describedById
				? { ...segment, describedById: `${uid}-reason-${segment.key}` }
				: segment,
		),
	);

	function pointerTitle(segment: GrainSegment): string | undefined {
		if (segment.available !== false) {
			return segment.hint ?? (segment.compactLabel ? segment.label : undefined);
		}
		if (!segment.compactLabel) return segment.title;
		return segment.title ? `${segment.label}: ${segment.title}` : segment.label;
	}

	const options = $derived(
		describedSegments.map(
			(segment): SegmentedChoiceOption => ({
				key: segment.key,
				label: segment.label,
				compactLabel: segment.compactLabel,
				disabled: segment.available === false,
				describedById: segment.describedById,
				title: pointerTitle(segment),
			}),
		),
	);

	function select(key: string): void {
		value = key;
		onSelect?.(key);
	}
</script>

<SegmentedChoice
	{options}
	{value}
	{label}
	onSelect={select}
	variant={variant === 'time-grid' ? 'joined-grid' : 'default'}
	data-variant={variant}
	data-slot="grain-picker"
	class={cn('grain-picker', variant === 'time-grid' && 'grain-picker--time-grid', className)}
/>

{#each describedSegments as segment (segment.key)}
	{#if segment.describedById === `${uid}-reason-${segment.key}`}
		<span id={segment.describedById} class="sr-only" data-slot="controls-reason"
			>{segment.title}</span
		>
	{/if}
{/each}
