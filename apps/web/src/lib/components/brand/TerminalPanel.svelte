<!--
  TerminalPanel — the ONE terminal-window idiom (brand Set B, §C2.3).

  A framed control-room panel: a titlebar carrying the three-aspect SIGNAL HEAD
  (proceed lit + caution/stop unlit at 25%), a mono --text-micro title, an
  optional tag + right meta slot; a body slot; and a mono footer-readout slot
  for honest stats (n · window · generated_utc). The panel rests at
  --shadow-section and wears the sanctioned rest-glow (use:cursorGlow, E2 —
  hero panels + the nav pill are the ONLY rest-glow exceptions). Chassis:
  2px --border-rule frame, radius --radius-lg, bg --surface-2 SOLID (the
  occlusion law — no alpha so the blueprint grid never bleeds through).

  ABSORBS TerminalChrome: this is a strict superset. TerminalChrome now
  re-exports as a thin alias over TerminalPanel (string tag/status/footer[]
  path preserved) so its four consumers keep working untouched — one terminal
  idiom, not two.

  GLOW LAW: rest-glow is a pointer-tracked opacity gradient (cursorGlow),
  NEVER a text-shadow. No text-shadow anywhere in this component (§C4 P4 /
  the FORBIDDEN guard's text-shadow ban). --primary stays interactive-only.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import StatusDot from './StatusDot.svelte';
	import { Separator } from '$lib/components/ui/separator';
	import { cursorGlow } from '@yesid/motion';
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
		/** Footer readout — string form (label/value items; the TerminalChrome path). */
		footerItems?: TerminalFooterItem[];
		/** Remove body padding (when children manage their own). */
		noPadding?: boolean;
		/** Disable the sanctioned rest-glow (e.g. dense-data framing). */
		noGlow?: boolean;
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
		noGlow = false,
		children,
		class: className,
		...rest
	}: TerminalPanelProps = $props();
</script>

<div
	class={cn('terminal-panel', className)}
	data-slot="terminal-panel"
	use:cursorGlow={noGlow ? { intensity: 0 } : { intensity: 0.06 }}
	{...rest}
>
	<!-- Titlebar — three-aspect SIGNAL HEAD (proceed lit + pulsing; caution +
	     stop unlit at 25%). Window furniture, not a data mark — aria-hidden. -->
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
		/* Sanctioned rest-glow chassis shadow (§C1 glow map). */
		box-shadow: var(--shadow-section);
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
	}

	.terminal-tag {
		border-radius: var(--radius-sm);
		padding: 0.125rem 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		background: var(--accent-surface);
		color: var(--accent-text);
	}

	.terminal-status,
	.terminal-meta {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
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
