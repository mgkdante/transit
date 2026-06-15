<!--
  TerminalChrome — mac-style terminal window chrome with a title bar and body slot.
  Brand primitive (Set B): a framed window with three decorative traffic-light
  dots, a mono title, an optional tag + status, a body slot and an optional
  footer metric row.
  Ported from yesid.dev TerminalChrome; CSS-only (no StatusDot/Separator deps,
  no scroll action). Re-themed to transit tokens — the chrome rides on --card /
  --border; the traffic-light dots stay fixed decorative chrome colours (they
  are window furniture, not data marks, so --primary stays interactive-only).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	export interface TerminalFooterItem {
		label: string;
		value: string;
	}

	export interface TerminalChromeProps {
		/** Terminal window title */
		title: string;
		/** Optional tag label next to title */
		tag?: string;
		/** Optional status text shown on the right of the title bar */
		status?: string;
		/** Optional footer metric items */
		footer?: TerminalFooterItem[];
		/** Remove body padding (when children manage their own) */
		noPadding?: boolean;
		/** Terminal body content */
		children?: Snippet;
		class?: string;
		[key: string]: unknown;
	}

	let {
		title,
		tag,
		status,
		footer,
		noPadding = false,
		children,
		class: className,
		...rest
	}: TerminalChromeProps = $props();
</script>

<div class={cn('terminal', className)} data-slot="terminal-chrome" {...rest}>
	<!-- Title bar — three decorative traffic-light dots (window furniture). -->
	<div class="terminal-titlebar">
		<div class="terminal-titlebar-lead">
			<span class="terminal-dots" aria-hidden="true">
				<span class="terminal-dot terminal-dot-close"></span>
				<span class="terminal-dot terminal-dot-min"></span>
				<span class="terminal-dot terminal-dot-max"></span>
			</span>
			<span class="terminal-title">{title}</span>
			{#if tag}
				<span class="terminal-tag">{tag}</span>
			{/if}
		</div>
		{#if status}
			<span class="terminal-status">{status}</span>
		{/if}
	</div>

	<!-- Body -->
	<div class="terminal-body" class:no-pad={noPadding}>
		{@render children?.()}
	</div>

	<!-- Footer metric row -->
	{#if footer && footer.length > 0}
		<div class="terminal-footer">
			{#each footer as item (item.label)}
				<div class="terminal-footer-item">
					<span class="terminal-footer-label">{item.label}</span>
					<span class="terminal-footer-value">{item.value}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.terminal {
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-lg);
		border: 1px solid var(--border);
		background: var(--card);
		overflow: hidden;
	}

	.terminal-titlebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--border-subtle);
	}

	.terminal-titlebar-lead {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* Decorative traffic-light dots — fixed chrome colours, not data marks. */
	.terminal-dots {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		margin-right: 0.25rem;
	}

	.terminal-dot {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: var(--radius-pill);
	}

	.terminal-dot-close {
		background: #ff5f56;
	}
	.terminal-dot-min {
		background: #ffbd2e;
	}
	.terminal-dot-max {
		background: #27c93f;
	}

	.terminal-title {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--secondary-foreground);
	}

	.terminal-tag {
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-subtle);
		padding: 0.125rem 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}

	.terminal-status {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
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
		border-top: 1px solid var(--border-subtle);
	}

	.terminal-footer-item {
		display: flex;
		gap: 0.5rem;
	}

	.terminal-footer-label {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}

	.terminal-footer-value {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--secondary-foreground);
	}
</style>
