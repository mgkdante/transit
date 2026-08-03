<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	export type StateNoticePresentation = 'row' | 'pill' | 'silo' | 'card' | 'responsive';
	export type StateNoticeTone = 'neutral' | 'positive' | 'warning' | 'error';

	export interface StateNoticeProps extends Omit<
		HTMLAttributes<HTMLElement>,
		'children' | 'title' | 'role' | 'aria-live' | 'aria-label'
	> {
		title: string;
		body?: string;
		glyph?: string;
		presentation?: StateNoticePresentation;
		tone?: StateNoticeTone;
		role?: 'status' | 'alert';
		ariaLive?: 'off' | 'polite' | 'assertive';
		ariaLabel?: string;
		meta?: Snippet;
		action?: Snippet;
		class?: string;
	}

	let {
		title,
		body,
		glyph = '○',
		presentation = 'responsive',
		tone = 'neutral',
		role,
		ariaLive,
		ariaLabel,
		meta,
		action,
		class: className,
		...restProps
	}: StateNoticeProps = $props();

	// A plain field-level pill remains valid inline markup. Notices with arbitrary
	// snippets use block-capable markup so their content cannot invalidate SSR.
	const element = $derived(
		(presentation === 'pill' || presentation === 'row') && !meta && !action ? 'span' : 'div',
	);
</script>

<svelte:element
	this={element}
	class={cn('state-notice', `state-notice--${presentation}`, className)}
	data-slot="state-notice"
	data-component="state-notice"
	data-presentation={presentation}
	data-tone={tone}
	{role}
	aria-live={ariaLive}
	aria-label={ariaLabel}
	{...restProps}
>
	<svelte:element this={element} class="state-notice-surface" data-part="surface">
		{#if presentation !== 'row'}
			<span class="state-notice-glyph" data-slot="state-notice-glyph" aria-hidden="true">
				{glyph}
			</span>
		{/if}

		<span class="state-notice-copy">
			<span class="state-notice-title" data-slot="state-notice-title">{title}</span>
			{#if body}
				{#if presentation === 'row' || presentation === 'pill'}<span
						class="state-notice-separator"
						aria-hidden="true"
					>
						·
					</span>&nbsp;{/if}<span class="state-notice-body" data-slot="state-notice-body"
					>{body}</span
				>
			{/if}
		</span>

		{#if meta}
			<div class="state-notice-meta" data-slot="state-notice-meta">
				{@render meta()}
			</div>
		{/if}

		{#if action}
			<div class="state-notice-action" data-slot="state-notice-action">
				{@render action()}
			</div>
		{/if}
	</svelte:element>
</svelte:element>

<style>
	.state-notice {
		--state-notice-ink: var(--dataviz-status-unknown);
		display: block;
		min-width: 0;
		max-width: 100%;
		color: var(--muted-foreground);
		font-family: inherit;
	}

	.state-notice--responsive {
		width: 100%;
		container-type: inline-size;
	}

	.state-notice[data-tone='positive'] {
		--state-notice-ink: var(--dataviz-status-on-time);
	}

	.state-notice[data-tone='warning'] {
		--state-notice-ink: var(--dataviz-status-late);
	}

	.state-notice[data-tone='error'] {
		--state-notice-ink: var(--dataviz-status-severe);
	}

	.state-notice-surface {
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
		min-width: 0;
		max-width: 100%;
		border: 1px solid var(--border);
		background: var(--muted);
	}

	.state-notice--pill {
		display: inline-block;
		width: fit-content;
	}

	.state-notice--row {
		display: inline;
		width: auto;
	}

	.state-notice--pill .state-notice-surface {
		align-items: center;
		flex-wrap: wrap;
		width: fit-content;
		padding: 0.25rem 0.625rem;
		border-radius: var(--radius-md);
	}

	.state-notice--row .state-notice-surface {
		display: inline;
		width: auto;
		padding: 0;
		border: 0;
		background: transparent;
	}

	.state-notice--silo .state-notice-surface,
	.state-notice--responsive .state-notice-surface {
		width: 100%;
		padding: 0.875rem 1rem;
		border-radius: var(--radius-md);
	}

	.state-notice--card .state-notice-surface {
		width: 100%;
		padding: 1.25rem;
		border-radius: var(--radius-lg);
	}

	.state-notice-glyph {
		flex: 0 0 auto;
		color: var(--state-notice-ink);
		font-family: var(--font-mono);
		font-weight: 800;
		line-height: 1.35;
	}

	.state-notice-copy {
		display: flex;
		flex: 1 1 12rem;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		max-inline-size: var(--measure-absence);
	}

	.state-notice--pill .state-notice-copy {
		display: inline-block;
		flex-basis: auto;
		max-width: 100%;
	}

	.state-notice--row .state-notice-copy {
		display: inline-block;
		max-width: 100%;
		max-inline-size: var(--measure-absence);
		font-weight: 500;
		vertical-align: top;
	}

	.state-notice-title,
	.state-notice-body {
		font-size: inherit;
		white-space: normal;
		overflow-wrap: anywhere;
	}

	.state-notice-title {
		color: var(--muted-foreground);
		font-weight: 500;
		line-height: 1.35;
	}

	.state-notice-body {
		color: var(--muted-foreground);
		line-height: 1.45;
	}

	.state-notice-separator {
		color: var(--state-notice-ink);
	}

	.state-notice--row .state-notice-separator {
		color: inherit;
	}

	.state-notice-meta,
	.state-notice-action {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		min-width: 0;
	}

	.state-notice-meta {
		color: var(--state-notice-ink);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}

	@container (min-width: 32rem) {
		.state-notice--responsive .state-notice-surface {
			align-items: center;
			padding: 1rem 1.125rem;
		}
	}
</style>
