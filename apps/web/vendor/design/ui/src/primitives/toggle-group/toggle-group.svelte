<script lang="ts" module>
	import { ToggleGroup as ToggleGroupTypes } from 'bits-ui';
	import { getContext, setContext } from 'svelte';
	import type { VariantProps } from 'tailwind-variants';
	import { toggleVariants } from '../toggle/index.js';

	type ToggleVariants = VariantProps<typeof toggleVariants>;

	export type ToggleGroupProps = ToggleGroupTypes.RootProps &
		ToggleVariants & {
			spacing?: number;
		};

	interface ToggleGroupContext extends ToggleVariants {
		spacing?: number;
		orientation?: 'horizontal' | 'vertical';
	}

	export function setToggleGroupCtx(props: ToggleGroupContext) {
		setContext('toggleGroup', props);
	}

	export function getToggleGroupCtx() {
		return getContext<Required<ToggleGroupContext>>('toggleGroup');
	}
</script>

<script lang="ts">
	import { ToggleGroup as ToggleGroupPrimitive } from 'bits-ui';
	import { cn } from '../../cn/index.js';

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		size = 'default',
		spacing = 0,
		orientation = 'horizontal',
		variant = 'default',
		style,
		...restProps
	}: ToggleGroupProps = $props();

	function getSingleValue(): string | undefined {
		return typeof value === 'string' ? value : undefined;
	}

	function setSingleValue(nextValue: string | undefined): void {
		value = nextValue;
	}

	function getMultipleValue(): string[] | undefined {
		return Array.isArray(value) ? value : undefined;
	}

	function setMultipleValue(nextValue: string[] | undefined): void {
		value = nextValue;
	}

	const rootClass = $derived(
		cn(
			'group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-vertical:flex-col data-vertical:items-stretch data-[size=sm]:rounded-[min(var(--radius-md),10px)]',
			className,
		),
	);
	const rootStyle = $derived(
		typeof style === 'string'
			? style
				? `${style}; --gap: ${spacing}`
				: `--gap: ${spacing}`
			: { ...(style ?? {}), '--gap': String(spacing) },
	);

	setToggleGroupCtx({
		get variant() {
			return variant;
		},
		get size() {
			return size;
		},
		get spacing() {
			return spacing;
		},
		get orientation() {
			return orientation;
		},
	});
</script>

<!-- spacing=0 => segmented control (shared borders, joined corners). -->
{#if restProps.type === 'single'}
	<ToggleGroupPrimitive.Root
		{...restProps}
		bind:value={getSingleValue, setSingleValue}
		bind:ref
		{orientation}
		data-slot="toggle-group"
		data-variant={variant}
		data-size={size}
		data-spacing={spacing}
		style={rootStyle}
		class={rootClass}
	/>
{:else}
	<ToggleGroupPrimitive.Root
		{...restProps}
		bind:value={getMultipleValue, setMultipleValue}
		bind:ref
		{orientation}
		data-slot="toggle-group"
		data-variant={variant}
		data-size={size}
		data-spacing={spacing}
		style={rootStyle}
		class={rootClass}
	/>
{/if}
