<!--
  TerminalChrome — terminal window chrome with a title bar and body slot.
  Brand primitive (Set B): a framed window whose title bar carries a three-aspect
  SIGNAL HEAD (proceed lit + caution/stop unlit at 25%), a mono title, an
  optional tag + status, a body slot and an optional footer metric row.
  Aligned to the yesid.dev TerminalChrome recipe (slice-9.7 A3) — composes the
  brand StatusDot signal head + the hazard Separator instead of decorative
  mac dots, and rides the dedicated terminal surface tokens (--terminal frame,
  --terminal-chrome titlebar/footer, --accent-surface/--accent-text tag +
  footer value, --border-rule frame). Tokens only — no hardcoded hex (the
  hardcoded mac traffic-light hexes are gone). --primary stays interactive-only.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import StatusDot from './StatusDot.svelte';
	import { Separator } from '$lib/components/ui/separator';
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
	<!-- Title bar — three-aspect SIGNAL HEAD (proceed lit + pulsing; caution +
	     stop unlit at 25%) replaces the old decorative mac traffic-light dots.
	     Window furniture, not a data mark — aria-hidden. -->
	<div class="terminal-titlebar">
		<div class="terminal-titlebar-lead">
			<span class="signal-head" data-slot="signal-head" aria-hidden="true">
				<StatusDot color="green" pulse size="sm" />
				<StatusDot color="caution" size="sm" class="opacity-25" />
				<StatusDot color="stop" size="sm" class="opacity-25" />
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

	<!-- Hazard stripe between the titlebar and the body. -->
	<Separator variant="hazard" hazardSize="sm" />

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
		border: 2px solid var(--border-rule);
		background: var(--terminal);
		overflow: hidden;
	}

	.terminal-titlebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--terminal-chrome);
	}

	.terminal-titlebar-lead {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* Signal head — three inline aspect dots (composed StatusDots). */
	.signal-head {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		margin-right: 0.25rem;
	}

	.terminal-title {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--secondary-foreground);
	}

	.terminal-tag {
		border-radius: var(--radius-sm);
		padding: 0.125rem 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		background: var(--accent-surface);
		color: var(--accent-text);
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
		background: var(--terminal-chrome);
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
		color: var(--accent-text);
	}
</style>
