<script lang="ts">
	import { tick } from 'svelte';
	import { Button } from '@yesid/ui/button';
	import type { Locale } from '$lib/i18n';
	import { copy } from './receipt.copy';

	let { text, locale }: { text: string; locale: Locale } = $props();
	const t = $derived(copy[locale].observation);
	const id = $props.id();
	let copyState = $state<'idle' | 'copying' | 'copied' | 'fallback'>('idle');
	let fallback = $state<HTMLTextAreaElement>();

	async function copyObservation(): Promise<void> {
		copyState = 'copying';
		try {
			await navigator.clipboard.writeText(text);
			copyState = 'copied';
		} catch {
			copyState = 'fallback';
			await tick();
			fallback?.focus();
			fallback?.select();
		}
	}
</script>

<div class="observation-copy" data-slot="observation-copy">
	<Button variant="outline" size="sm" disabled={copyState === 'copying'} onclick={copyObservation}>
		{copyState === 'copying' ? t.copying : t.copy}
	</Button>
	<p role="status" aria-live="polite" aria-atomic="true">
		{copyState === 'copied' ? t.copied : copyState === 'fallback' ? t.fallback : ''}
	</p>
	{#if copyState === 'fallback'}
		<label for={id}>{t.text}</label>
		<textarea {id} bind:this={fallback} readonly value={text} rows="12"></textarea>
	{/if}
</div>

<style>
	.observation-copy {
		display: grid;
		justify-items: start;
		gap: 0.5rem;
	}
	p {
		margin: 0;
		font-size: var(--text-caption);
	}
	p:empty {
		display: none;
	}
	textarea {
		width: 100%;
		min-width: 0;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--background);
		color: var(--foreground);
		font: inherit;
		resize: vertical;
	}
</style>
