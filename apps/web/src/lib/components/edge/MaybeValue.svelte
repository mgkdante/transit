<script lang="ts">
	import type { Snippet } from 'svelte';
	import AbsentValue from './AbsentValue.svelte';
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import type { Locale } from '$lib/i18n';

	export interface MaybeValueProps {
		value?: string | null;
		present?: boolean;
		children?: Snippet;
		reason: AbsenceReasonKey;
		locale: Locale;
		params?: Readonly<Record<string, string | number>>;
		variant?: 'inline' | 'row' | 'block';
	}

	let {
		value,
		present,
		children,
		reason,
		locale,
		params,
		variant = 'inline',
	}: MaybeValueProps = $props();

	const show = $derived(present ?? (value != null && value !== ''));
</script>

{#if show}{#if children}{@render children()}{:else}{value}{/if}{:else}<AbsentValue
		{reason}
		{locale}
		{params}
		{variant}
	/>{/if}
