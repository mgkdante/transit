<!--
  GrainPicker — semantic adapter for historic roll-up choices.

  Callers keep the existing grain vocabulary and bindable value. The shared
  SegmentedChoice primitive owns radio semantics, keyboard behavior, targets,
  motion, and the optional joined layout.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import SegmentedChoice from './SegmentedChoice.svelte';
	import type { SegmentedChoiceOption } from './SegmentedChoice.svelte';

	export type GrainPickerVariant = 'default' | 'time-grid';

	/** One offered grain segment. `available:false` renders disabled (never picked). */
	export interface GrainSegment<K extends string = string> {
		readonly key: K;
		readonly label: string;
		readonly compactLabel?: string;
		readonly available?: boolean;
		readonly describedById?: string;
		/** Pointer explanation for an unavailable segment. */
		readonly title?: string;
		/** Pointer explanation for an available segment. */
		readonly hint?: string;
	}

	export interface GrainPickerProps<K extends string = string> {
		readonly segments: readonly GrainSegment<K>[];
		value: K;
		readonly label: string;
		readonly variant?: GrainPickerVariant;
		readonly class?: string;
	}

	let {
		segments,
		value = $bindable(),
		label,
		variant = 'default',
		class: className,
	}: GrainPickerProps = $props();

	function pointerTitle(segment: GrainSegment): string | undefined {
		if (segment.available !== false) {
			return segment.hint ?? (segment.compactLabel ? segment.label : undefined);
		}
		if (!segment.compactLabel) return segment.title;
		return segment.title ? `${segment.label}: ${segment.title}` : segment.label;
	}

	const options = $derived(
		segments.map(
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
	}
</script>

<SegmentedChoice
	{options}
	{value}
	{label}
	onSelect={select}
	variant={variant === 'time-grid' ? 'joined-grid' : 'default'}
	dataVariant={variant}
	dataSlot="grain-picker"
	class={cn('grain-picker', variant === 'time-grid' && 'grain-picker--time-grid', className)}
/>
