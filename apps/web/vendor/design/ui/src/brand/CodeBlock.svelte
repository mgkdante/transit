<!--
  Source code in a TerminalPanel: the language as its tag and an optional copy button. `children`
  is the app's highlighted `<pre>`, colored through the `--syntax-*` tokens; without it the code
  shows as plain text.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export interface CodeBlockCopyLabels {
		label: string;
		ariaLabel: string;
		/** Shown when the clipboard refuses the copy. */
		failed: string;
	}

	export interface CodeBlockProps {
		/** The source. The copy button copies it. */
		code: string;
		title: string;
		language?: string;
		/** Shows a copy button with these labels. */
		copy?: CodeBlockCopyLabels;
		children?: Snippet;
		class?: string;
	}
</script>

<script lang="ts">
	import { cn } from '../cn/index.js';
	import TerminalPanel from './TerminalPanel.svelte';

	let { code, title, language, copy, children, class: className }: CodeBlockProps = $props();

	let copyState = $state<'idle' | 'copied' | 'failed'>('idle');
	let resetTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyCode() {
		try {
			await navigator.clipboard.writeText(code);
			copyState = 'copied';
		} catch {
			copyState = 'failed';
		}
		clearTimeout(resetTimer);
		resetTimer = setTimeout(() => (copyState = 'idle'), 2000);
	}

	$effect(() => () => clearTimeout(resetTimer));
</script>

{#snippet copyButton()}
	<button type="button" class="terminal-code-copy" onclick={copyCode} aria-label={copy?.ariaLabel}>
		{copyState === 'copied' ? '✓' : copyState === 'failed' ? copy?.failed : copy?.label}
	</button>
{/snippet}

<TerminalPanel
	{title}
	tag={language}
	actions={copy ? copyButton : undefined}
	noPadding
	class={cn('terminal-code', className)}
	data-code-language={language}
>
	<div class="terminal-code-body">
		{#if children}
			{@render children()}
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<pre tabindex="0"><code>{code}</code></pre>
		{/if}
	</div>
</TerminalPanel>
