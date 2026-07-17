<!--
  TerminalPanel — the ONE terminal-window idiom (brand Set B, §C2.3).

  A framed control-room panel: a titlebar carrying the three-aspect SIGNAL HEAD
  (proceed lit + caution/stop unlit at 25%), a mono --text-micro title, an
  optional tag + right meta slot; a body slot; and a mono footer-readout slot
  for honest stats (n · window · generated_utc). The chassis is deliberately
  flat: 2px --border-rule frame, radius --radius-lg, bg --surface-2 SOLID. Data
  panels never carry cursor halos, pulsing lamps or decorative outer shadows.

  ABSORBED TerminalChrome (P5.3c · D3): the old TerminalChrome alias is RETIRED —
  this is now the ONE terminal-window idiom. Its string footer[] path lives on as
  the `footerItems` prop (label/value items), so the former consumers (home pulse,
  receipt, _kit) migrated to TerminalPanel directly with no visual change.

  --primary stays interactive-only. Focus indicators belong to the controls
  inside the panel and are not removed by this flat-surface rule.
-->
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
		/** Terminal window title (mono, --text-micro). */
		title: string;
		/** Optional tag label next to the title. */
		tag?: string;
		/** Optional status text on the right of the titlebar (string form). */
		status?: string;
		/** Right-side meta slot (snippet form; overrides `status` when present). */
		meta?: Snippet;
		/** Footer readout — snippet form (honest stats: n · window · generated_utc). */
		footer?: Snippet;
		/** Footer readout — string form (label/value items; the former TerminalChrome path). */
		footerItems?: TerminalFooterItem[];
		/** Remove body padding (when children manage their own). */
		noPadding?: boolean;
		/** Terminal body content. */
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
	<!-- Titlebar — three-aspect SIGNAL HEAD (proceed lit; caution +
	     stop unlit at 25%). Window furniture, not a data mark — aria-hidden. -->
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

	<!-- Hazard stripe between the titlebar and the body. -->
	<Separator variant="hazard" hazardSize="sm" />

	<!-- Body -->
	<div class="terminal-body" class:no-pad={noPadding}>
		{@render children?.()}
	</div>

	<!-- Footer readout — snippet form wins; else the label/value string form. -->
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
		/* SOLID surface — the occlusion law (§C1). No alpha; the grid never bleeds through. */
		background: var(--surface-2);
		overflow: hidden;
	}

	.terminal-titlebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		/* Wrap the whole status readout to its own line on narrow titlebars (≈390px)
		   rather than letting the tag/status squeeze into mid-word breaks ("LI VE").
		   The row-gap keeps the wrapped status legible under the lead group. */
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

	/* Signal head — three inline aspect dots (composed StatusDots). */
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
		/* Whole-unit wrap: the status readout reflows to its own titlebar line
		   rather than breaking mid-word when the 390px titlebar gets tight. */
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
