<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { AbsentValue } from '$lib/components/edge';
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import type { Locale } from '$lib/i18n';

	export interface MetricDisplayProps extends HTMLAttributes<HTMLDivElement> {
		value: string | null | undefined;
		absentReason?: AbsenceReasonKey;
		locale?: Locale;
		absentParams?: Readonly<Record<string, string | number>>;
		label: string;
		info?: Snippet;
		sublabel?: string;
		size?: 'sm' | 'md' | 'lg';
		labelBelow?: boolean;
		class?: string;
	}

	let {
		value,
		absentReason,
		locale,
		absentParams,
		label,
		info,
		sublabel,
		size = 'md',
		labelBelow = false,
		class: className,
		...restProps
	}: MetricDisplayProps = $props();

	const valueClass = {
		sm: 'text-subheading',
		md: 'text-heading',
		lg: 'text-title',
	} as const;

	const isEmpty = $derived(value == null || value === '');
</script>

<div class={cn('flex flex-col', className)} data-slot="metric-display" {...restProps}>
	{#if !labelBelow}
		<div class="flex items-center gap-1">
			<span class="label-metric">{label}</span>
			{@render info?.()}
		</div>
	{/if}
	{#if isEmpty}
		{#if absentReason && locale}
			<AbsentValue variant="inline" reason={absentReason} {locale} params={absentParams} />
		{/if}
	{:else}
		<span
			class={cn(
				'metric-value font-heading font-extrabold leading-none text-accent-text',
				valueClass[size],
			)}>{value}</span
		>
	{/if}
	{#if labelBelow}
		<div class="mt-2 flex items-center gap-1">
			<span class="label-metric">{label}</span>
			{@render info?.()}
		</div>
	{/if}
	{#if sublabel}
		<span class="mt-1 font-mono text-caption text-[var(--muted-foreground)]">{sublabel}</span>
	{/if}
</div>
