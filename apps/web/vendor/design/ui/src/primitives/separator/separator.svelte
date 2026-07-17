<script lang="ts" module>
	export type SeparatorVariant = 'default' | 'hazard' | 'gradient';
	export type HazardSize = 'sm' | 'md' | 'lg';
</script>

<script lang="ts">
	import { Separator as SeparatorPrimitive } from 'bits-ui';
	import { cn } from '../../cn/index.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default' as SeparatorVariant,
		hazardSize = 'md' as HazardSize,
		hazardAngle = -45,
		maxWidth = 'var(--width-content)',
		label,
		'data-slot': dataSlot = 'separator',
		...restProps
	}: SeparatorPrimitive.RootProps & {
		variant?: SeparatorVariant;
		hazardSize?: HazardSize;
		hazardAngle?: number;
		maxWidth?: string;
		label?: string;
	} = $props();

	const stripeWidth = { sm: 6, md: 8, lg: 12 } as const;
	const hazardHeightClass = { sm: 'h-[3px]', md: 'h-1.5', lg: 'h-2.5' } as const;
	const hazardWidthClass = { sm: 'w-[3px]', md: 'w-1.5', lg: 'w-2.5' } as const;

	const isVertical = $derived(restProps.orientation === 'vertical');

	// Hazard = real safety tape: yellow (--hazard-a) + warm black (--hazard-b),
	// theme-invariant tokens so the tape never reskins when the lights change.
	const hazardGradient = $derived(
		variant === 'hazard'
			? `repeating-linear-gradient(${hazardAngle}deg, var(--hazard-a) 0px, var(--hazard-a) ${stripeWidth[hazardSize]}px, var(--hazard-b) ${stripeWidth[hazardSize]}px, var(--hazard-b) ${stripeWidth[hazardSize] * 2}px)`
			: '',
	);
</script>

{#if variant === 'hazard'}
	{#if label}
		<div class={cn('flex items-center gap-3', className)} aria-hidden="true" {...restProps}>
			<div
				class={cn(hazardHeightClass[hazardSize], 'flex-1 rounded-sm')}
				style="background: {hazardGradient};"
			></div>
			<span class="label-station shrink-0">{label}</span>
			<div
				class={cn(hazardHeightClass[hazardSize], 'flex-1 rounded-sm')}
				style="background: {hazardGradient};"
			></div>
		</div>
	{:else}
		<div
			class={cn(
				isVertical
					? [hazardWidthClass[hazardSize], 'h-full rounded-sm']
					: [hazardHeightClass[hazardSize], 'w-full rounded-sm'],
				className,
			)}
			style="background: {hazardGradient};"
			aria-hidden="true"
			{...restProps}
		></div>
	{/if}
{:else if variant === 'gradient'}
	<div
		class={cn('relative mx-auto w-full py-4', className)}
		style="max-width: {maxWidth};"
		aria-hidden="true"
		{...restProps}
	>
		<div class="gradient-separator-line" data-testid="gradient-separator"></div>
		{#if label}
			<div class="label-station mt-2" data-testid="separator-label">{label}</div>
		{/if}
	</div>
{:else}
	<SeparatorPrimitive.Root
		bind:ref
		data-slot={dataSlot}
		class={cn(
			'shrink-0 bg-border-subtle data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
			className,
		)}
		{...restProps}
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
