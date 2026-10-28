<!--
  Terminal window: a title bar with the three-aspect signal head, a hazard rule, a scrolling body
  and an optional footer readout. Styled by the global `.terminal-*` classes in `base.css`, which
  server-rendered markup can reuse.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface TerminalFooterItem {
		label: string;
		value: string;
	}

	export interface TerminalPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
		title: string;
		/** Short label beside the title, such as a language or a version. */
		tag?: string;
		status?: string;
		/** Controls at the end of the title bar. */
		actions?: Snippet;
		footer?: readonly TerminalFooterItem[];
		/** Drops the body padding for content that pads itself. */
		noPadding?: boolean;
		children: Snippet;
		class?: string;
	}
</script>

<script lang="ts">
	import { scrollChain } from '@yesid/motion/actions';
	import { cn } from '../cn/index.js';
	import { Separator } from '../primitives/separator/index.js';

	let {
		title,
		tag,
		status,
		actions,
		footer = [],
		noPadding = false,
		children,
		class: className,
		...rest
	}: TerminalPanelProps = $props();
</script>

<div class={cn('terminal', className)} data-slot="terminal-panel" {...rest}>
	<div class="terminal-titlebar">
		<div class="terminal-titlebar-main">
			<span class="terminal-signal-head" aria-hidden="true">
				<span class="terminal-signal terminal-signal-green led-pulse"></span>
				<span class="terminal-signal terminal-signal-caution"></span>
				<span class="terminal-signal terminal-signal-stop"></span>
			</span>
			<span class="terminal-title">{title}</span>
			{#if tag}
				<span class="terminal-tag">{tag}</span>
			{/if}
		</div>
		{#if status || actions}
			<div class="terminal-titlebar-actions">
				{#if status}
					<span class="terminal-status">{status}</span>
				{/if}
				{@render actions?.()}
			</div>
		{/if}
	</div>

	<Separator variant="hazard" hazardSize="sm" />

	<div class="terminal-body" class:no-pad={noPadding} use:scrollChain>
		{@render children()}
	</div>

	{#if footer.length > 0}
		<div class="terminal-footer">
			{#each footer as item, i (i)}
				<div class="terminal-footer-item">
					<span class="terminal-footer-label">{item.label}</span>
					<span class="terminal-footer-value">{item.value}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
