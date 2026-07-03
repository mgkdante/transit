<!--
  TerminalChrome — thin alias over TerminalPanel (§C2.3 absorption).

  TerminalChrome's prop API (title/tag/status/footer[]/noPadding) is UNCHANGED
  so its four consumers (home pulse, receipt headline/worst/affected, _kit)
  inherit the chrome untouched. The implementation now lives in TerminalPanel —
  ONE terminal idiom, not two. The `footer: TerminalFooterItem[]` array maps to
  TerminalPanel's `footerItems`; everything else is a straight passthrough.

  Migration note: new consumers should reach for TerminalPanel directly (it
  adds the `meta`/`footer` snippet slots + the sanctioned rest-glow). This
  alias exists only to keep the existing call-sites working without a churn.
-->
<script lang="ts">
	import TerminalPanel from './TerminalPanel.svelte';
	import type { TerminalFooterItem } from './TerminalPanel.svelte';

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
		children?: import('svelte').Snippet;
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

<TerminalPanel
	{title}
	{tag}
	{status}
	footerItems={footer}
	{noPadding}
	class={className}
	data-slot="terminal-chrome"
	{...rest}
>
	{@render children?.()}
</TerminalPanel>
