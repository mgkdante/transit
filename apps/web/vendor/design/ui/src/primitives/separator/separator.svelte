<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Separator as SeparatorTypes } from 'bits-ui';
	import type { WithElementRef } from '../../cn/index.js';

	export type SeparatorVariant = 'default' | 'hazard' | 'gradient';
	export type HazardSize = 'sm' | 'md' | 'lg';

	type CustomSeparatorElementProps = WithElementRef<
		Omit<HTMLAttributes<HTMLDivElement>, 'children'>,
		HTMLDivElement
	> & {
		orientation?: 'horizontal' | 'vertical';
		child?: never;
		children?: never;
		decorative?: never;
	};

	type SeparatorDefaultProps = SeparatorTypes.RootProps & {
		variant?: 'default';
		hazardSize?: never;
		hazardAngle?: never;
		maxWidth?: never;
		label?: never;
	};

	type SeparatorHazardProps = CustomSeparatorElementProps & {
		variant: 'hazard';
		hazardSize?: HazardSize;
		hazardAngle?: number;
		maxWidth?: string;
		label?: string;
	};

	type SeparatorGradientProps = CustomSeparatorElementProps & {
		variant: 'gradient';
		hazardSize?: never;
		hazardAngle?: never;
		maxWidth?: string;
		label?: string;
	};

	export type SeparatorProps =
		| SeparatorDefaultProps
		| SeparatorHazardProps
		| SeparatorGradientProps;
</script>

<script lang="ts">
	import { Separator as SeparatorPrimitive } from 'bits-ui';
	import { cn } from '../../cn/index.js';

	let { ref = $bindable(null), ...separatorProps }: SeparatorProps = $props();

	const stripeWidth = { sm: 6, md: 8, lg: 12 } as const;
	const hazardHeightClass = { sm: 'h-[3px]', md: 'h-1.5', lg: 'h-2.5' } as const;
	const hazardWidthClass = { sm: 'w-[3px]', md: 'w-1.5', lg: 'w-2.5' } as const;

	// Hazard = real safety tape: yellow (--hazard-a) + warm black (--hazard-b),
	// theme-invariant tokens so the tape never reskins when the lights change.
	function getHazardGradient(angle: number, size: HazardSize): string {
		return `repeating-linear-gradient(${angle}deg, var(--hazard-a) 0px, var(--hazard-a) ${stripeWidth[size]}px, var(--hazard-b) ${stripeWidth[size]}px, var(--hazard-b) ${stripeWidth[size] * 2}px)`;
	}

	function getHazardProps(props: SeparatorHazardProps) {
		const {
			variant,
			hazardSize = 'md',
			hazardAngle = -45,
			maxWidth = 'var(--width-content)',
			label,
			orientation = 'horizontal',
			child,
			children,
			decorative,
			class: className,
			style,
			'data-slot': dataSlot = 'separator',
			...nativeProps
		} = props;
		void variant;
		void child;
		void children;
		void decorative;
		return {
			hazardSize,
			maxWidth,
			label,
			isVertical: orientation === 'vertical',
			className,
			style,
			dataSlot,
			hazardGradient: getHazardGradient(hazardAngle, hazardSize),
			nativeProps,
		};
	}

	function getGradientProps(props: SeparatorGradientProps) {
		const {
			variant,
			hazardSize,
			hazardAngle,
			maxWidth = 'var(--width-content)',
			label,
			orientation,
			child,
			children,
			decorative,
			class: className,
			style,
			'data-slot': dataSlot = 'separator',
			...nativeProps
		} = props;
		void variant;
		void hazardSize;
		void hazardAngle;
		void orientation;
		void child;
		void children;
		void decorative;
		return { maxWidth, label, className, style, dataSlot, nativeProps };
	}

	function getDefaultProps(props: SeparatorDefaultProps) {
		const {
			variant,
			hazardSize,
			hazardAngle,
			maxWidth,
			label,
			class: className,
			'data-slot': dataSlot = 'separator',
			...rootProps
		} = props;
		void variant;
		void hazardSize;
		void hazardAngle;
		void maxWidth;
		void label;
		return { className, dataSlot, rootProps };
	}
</script>

{#if separatorProps.variant === 'hazard'}
	{@const hazard = getHazardProps(separatorProps)}
	{#if hazard.label}
		<div
			{...hazard.nativeProps}
			bind:this={ref}
			data-slot={hazard.dataSlot}
			class={cn('flex items-center gap-3', hazard.className)}
			style={hazard.style}
			style:max-width={hazard.maxWidth}
			aria-hidden="true"
		>
			<div
				class={cn(hazardHeightClass[hazard.hazardSize], 'flex-1 rounded-sm')}
				style:background={hazard.hazardGradient}
			></div>
			<span class="label-station shrink-0">{hazard.label}</span>
			<div
				class={cn(hazardHeightClass[hazard.hazardSize], 'flex-1 rounded-sm')}
				style:background={hazard.hazardGradient}
			></div>
		</div>
	{:else}
		<div
			{...hazard.nativeProps}
			bind:this={ref}
			data-slot={hazard.dataSlot}
			class={cn(
				hazard.isVertical
					? [hazardWidthClass[hazard.hazardSize], 'h-full rounded-sm']
					: [hazardHeightClass[hazard.hazardSize], 'w-full rounded-sm'],
				hazard.className,
			)}
			style={hazard.style}
			style:max-width={hazard.maxWidth}
			style:background={hazard.hazardGradient}
			aria-hidden="true"
		></div>
	{/if}
{:else if separatorProps.variant === 'gradient'}
	{@const gradient = getGradientProps(separatorProps)}
	<div
		{...gradient.nativeProps}
		bind:this={ref}
		data-slot={gradient.dataSlot}
		class={cn('relative mx-auto w-full py-4', gradient.className)}
		style={gradient.style}
		style:max-width={gradient.maxWidth}
		aria-hidden="true"
	>
		<div class="gradient-separator-line" data-testid="gradient-separator"></div>
		{#if gradient.label}
			<div class="label-station mt-2" data-testid="separator-label">{gradient.label}</div>
		{/if}
	</div>
{:else}
	{@const separator = getDefaultProps(separatorProps)}
	<SeparatorPrimitive.Root
		{...separator.rootProps}
		bind:ref
		data-slot={separator.dataSlot}
		class={cn(
			'shrink-0 bg-border-subtle data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
			separator.className,
		)}
	/>
{/if}

<style>
	/* Brand chrome line — orange→yellow flow. Decorative branding, NOT a data
	   mark, so --primary/--accent are doctrine-compliant here. */
	.gradient-separator-line {
		height: 2px;
		border-radius: var(--radius-pill);
		background: linear-gradient(
			90deg,
			var(--primary),
			var(--accent),
			var(--primary),
			var(--accent)
		);
		background-size: 200% 100%;
		animation: gradient-flow 3s linear infinite;
	}

	@keyframes gradient-flow {
		0% {
			background-position: 0% 0%;
		}
		100% {
			background-position: 200% 0%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.gradient-separator-line {
			animation: none;
			background: linear-gradient(90deg, var(--primary), var(--accent));
			background-size: 100% 100%;
		}
	}
</style>
