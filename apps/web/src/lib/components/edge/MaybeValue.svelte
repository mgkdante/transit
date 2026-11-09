<script lang="ts">
	import type { Snippet } from 'svelte';
	import AbsentValue from './AbsentValue.svelte';
	import type { AbsenceReasonKey } from '#lib/site/absence.ts';
	import type { Locale } from '#lib/i18n/index.ts';

	export interface MaybeValueProps {
		value?: string | null;
		present?: boolean;
		children?: Snippet;
		reason: AbsenceReasonKey;
		locale: Locale;
		params?: Readonly<Record<string, string | number>>;
		variant?: 'inline' | 'row' | 'block' | 'compact';
		disclosure?: boolean;
	}

	let {
		value,
		present,
		children,
		reason,
		locale,
		params,
		variant = 'inline',
		disclosure = true,
	}: MaybeValueProps = $props();

	const show = $derived(present ?? (value != null && value !== ''));
</script>

{#if show}{#if children}{@render children()}{:else}{value}{/if}{:else}<AbsentValue
		{reason}
		{locale}
		{params}
		{variant}
		{disclosure}
	/>{/if}
