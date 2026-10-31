<script lang="ts">
	import type { Snippet } from 'svelte';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import SigmaIcon from '@lucide/svelte/icons/sigma';
	import BanIcon from '@lucide/svelte/icons/ban';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import WorkflowIcon from '@lucide/svelte/icons/workflow';
	import NotebookTextIcon from '@lucide/svelte/icons/notebook-text';
	import { CodeBlock } from '@yesid/ui/brand';

	export type InformationKind =
		| 'definition'
		| 'math'
		| 'sql'
		| 'not-really'
		| 'caveat'
		| 'pipeline-note'
		| 'note';

	export interface TypedInformationCardProps {
		kind: InformationKind;
		label: string;
		code?: string;
		/** `@yesid/seo-kit/highlight` markup for `code`; without it the code shows as plain text. */
		codeHtml?: string;
		codeAriaLabel?: string;
		children?: Snippet;
		class?: string;
	}

	let {
		kind,
		label,
		code,
		codeHtml,
		codeAriaLabel,
		children,
		class: className,
	}: TypedInformationCardProps = $props();
</script>

{#if kind === 'sql'}
	<div
		class={`typed-information-card typed-information-card--sql ${className ?? ''}`}
		data-slot="typed-information-card"
		data-kind={kind}
	>
		<CodeBlock title={label} language="SQL" code={code ?? ''}>
			<!-- eslint-disable svelte/no-at-html-tags -- codeHtml is escaped token markup from @yesid/seo-kit/highlight. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<pre tabindex="0" role="region" aria-label={codeAriaLabel ?? 'SQL source'}><code
					>{#if codeHtml}{@html codeHtml}{:else}{code}{/if}</code
				></pre>
			<!-- eslint-enable svelte/no-at-html-tags -->
		</CodeBlock>
	</div>
{:else}
	<div
		class={`typed-information-card typed-information-card--normal ${className ?? ''}`}
		data-slot="typed-information-card"
		data-kind={kind}
	>
		<h3 class="typed-information-badge" data-slot="typed-information-badge">
			{#if kind === 'definition'}
				<BookOpenIcon size={18} strokeWidth={2} aria-hidden="true" />
			{:else if kind === 'math'}
				<SigmaIcon size={18} strokeWidth={2} aria-hidden="true" />
			{:else if kind === 'not-really'}
				<BanIcon size={18} strokeWidth={2} aria-hidden="true" />
			{:else if kind === 'caveat'}
				<TriangleAlertIcon size={18} strokeWidth={2} aria-hidden="true" />
			{:else if kind === 'pipeline-note'}
				<WorkflowIcon size={18} strokeWidth={2} aria-hidden="true" />
			{:else}
				<NotebookTextIcon size={18} strokeWidth={2} aria-hidden="true" />
			{/if}
			<span>{label}</span>
		</h3>

		<div class="typed-information-body" data-slot="typed-information-body">
			{@render children?.()}
		</div>
	</div>
{/if}

<style>
	.typed-information-card {
		min-width: 0;
	}

	.typed-information-card--normal {
		display: flex;
		min-height: 8rem;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem 1.125rem 1.25rem;
		border: 1px solid color-mix(in srgb, var(--information-accent) 42%, var(--border) 58%);
		border-radius: var(--radius-lg);
		background: var(--surface-2);
	}

	.typed-information-card[data-kind='definition'] {
		--information-accent: var(--signal-lunar);
	}
	.typed-information-card[data-kind='math'] {
		--information-accent: color-mix(
			in srgb,
			var(--dataviz-status-early) 90%,
			var(--foreground) 10%
		);
	}
	.typed-information-card[data-kind='not-really'] {
		--information-accent: var(--dataviz-status-severe);
	}
	.typed-information-card[data-kind='caveat'] {
		--information-accent: var(--dataviz-status-late);
	}
	.typed-information-card[data-kind='pipeline-note'] {
		--information-accent: var(--dataviz-occupancy-standing);
	}
	.typed-information-card[data-kind='note'] {
		--information-accent: var(--dataviz-status-unknown);
	}

	.typed-information-badge {
		align-self: flex-end;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 0.375rem 0.625rem;
		border: 1px solid color-mix(in srgb, var(--information-accent) 50%, var(--border) 50%);
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--information-accent) 12%, var(--surface-2) 88%);
		color: var(--information-accent);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		line-height: 1;
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
	}

	.typed-information-body {
		color: var(--foreground);
		font-size: var(--text-reading, 1.1875rem);
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.typed-information-body :global(:first-child) {
		margin-block-start: 0;
	}
	.typed-information-body :global(:last-child) {
		margin-block-end: 0;
	}
	.typed-information-card--sql pre {
		font-size: var(--text-reading-code, 1rem);
		line-height: 1.6;
	}

	@media (--desktop-min) {
		.typed-information-body {
			font-size: var(--text-reading-desktop, 1.25rem);
		}
		.typed-information-card--sql pre {
			font-size: var(--text-reading-code-desktop, 1.0625rem);
		}
	}
</style>
