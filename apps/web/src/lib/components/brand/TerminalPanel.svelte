<script lang="ts">
	import type { Snippet } from 'svelte';
	import StatusDot from './StatusDot.svelte';
	import { Separator } from '@yesid/ui/separator';
	import { cn } from '$lib/utils';

	export interface TerminalFooterItem {
		label: string;
		value: string;
	}

	export interface TerminalPanelProps {
		title: string;
		tag?: string;
		status?: string;
		meta?: Snippet;
		footer?: Snippet;
		footerItems?: TerminalFooterItem[];
		noPadding?: boolean;
		children?: Snippet;
		class?: string;
		[key: string]: unknown;
	}

	let {
		title,
		tag,
		status,
		meta,
		footer,
		footerItems,
		noPadding = false,
		children,
		class: className,
		...rest
	}: TerminalPanelProps = $props();
</script>

<div class={cn('terminal-panel', className)} data-slot="terminal-panel" {...rest}>
	<div class="terminal-titlebar">
		<div class="terminal-titlebar-lead">
			<span class="signal-head" data-slot="signal-head" aria-hidden="true">
				<StatusDot color="green" size="sm" />
				<StatusDot color="caution" size="sm" class="opacity-25" />
				<StatusDot color="stop" size="sm" class="opacity-25" />
			</span>
			<span class="terminal-title">{title}</span>
			{#if tag}
				<span class="terminal-tag">{tag}</span>
			{/if}
		</div>
		{#if meta}
			<span class="terminal-meta" data-slot="terminal-meta">{@render meta()}</span>
		{:else if status}
			<span class="terminal-status">{status}</span>
		{/if}
	</div>

	<Separator variant="hazard" hazardSize="sm" />

	<div class="terminal-body" class:no-pad={noPadding}>
		{@render children?.()}
	</div>

	{#if footer}
		<div class="terminal-footer" data-slot="terminal-footer">{@render footer()}</div>
	{:else if footerItems && footerItems.length > 0}
		<div class="terminal-footer" data-slot="terminal-footer">
			{#each footerItems as item (item.label)}
				<div class="terminal-footer-item">
					<span class="terminal-footer-label">{item.label}</span>
					<span class="terminal-footer-value">{item.value}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.terminal-panel {
		position: relative;
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-lg);
		border: 2px solid var(--border-rule);
		background: var(--surface-2);
		overflow: hidden;
	}

	.terminal-titlebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--terminal-chrome);
	}

	.terminal-titlebar-lead {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.signal-head {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-right: 0.25rem;
	}

	.terminal-title {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--secondary-foreground);
		white-space: nowrap;
	}

	.terminal-tag {
		border-radius: var(--radius-sm);
		padding: 0.125rem 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		background: var(--accent-surface);
		color: var(--accent-text);
		white-space: nowrap;
	}

	.terminal-status,
	.terminal-meta {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
		white-space: nowrap;
	}

	.terminal-body {
		flex: 1;
		padding: 0.75rem 1rem;
		overflow-y: auto;
	}
	.terminal-body.no-pad {
		padding: 0;
	}

	.terminal-footer {
		display: flex;
		gap: 1.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--terminal-chrome);
		border-top: 1px solid var(--border-subtle);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}

	.terminal-footer-item {
		display: flex;
		gap: 0.5rem;
	}

	.terminal-footer-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}

	.terminal-footer-value {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--accent-text);
	}
</style>
