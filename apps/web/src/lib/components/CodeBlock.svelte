<script lang="ts">
	import { tokenizeSql, type CodeToken } from './sql-highlight';

	export interface CodeBlockProps {
		code: string;
		lang?: string;
		ariaLabel?: string;
		embedded?: boolean;
		class?: string;
	}

	let {
		code,
		lang = 'SQL',
		ariaLabel,
		embedded = false,
		class: className,
	}: CodeBlockProps = $props();

	const tokens: CodeToken[] = $derived(tokenizeSql(code));
</script>

<figure class={`codeblock ${className ?? ''}`} class:codeblock--embedded={embedded}>
	{#if !embedded}
		<figcaption class="codeblock__chrome">
			<span class="codeblock__lang">{lang}</span>
		</figcaption>
	{/if}
	<!-- Keyboard access to overflow. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<pre
		class="codeblock__pre"
		tabindex="0"
		role="region"
		aria-label={ariaLabel ?? `${lang} source`}><code class="codeblock__code"
			>{#each tokens as token, i (i)}<span class={`tok tok--${token.type}`}>{token.value}</span
				>{/each}</code
		></pre>
</figure>

<style>
	.codeblock {
		--code-keyword: #c98a5e;
		--code-string: #7fae6f;
		--code-number: #c98fd6;
		--code-function: #6fa8c9;
		--code-comment: var(--muted-foreground);
		--code-punctuation: var(--muted-foreground);
		--code-plain: var(--foreground);

		margin: 0;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--card);
		overflow: hidden;
	}
	.codeblock--embedded {
		border: 0;
		border-radius: 0;
		background: var(--terminal);
	}

	:global([data-theme='light']) .codeblock,
	:global(.theme-light) .codeblock {
		--code-keyword: #9a4a14;
		--code-string: #3f6e2c;
		--code-number: #7d3b8f;
		--code-function: #245a73;
	}

	.codeblock__chrome {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		border-block-end: 1px solid var(--border);
		background: var(--muted);
	}
	.codeblock__lang {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}

	.codeblock__pre {
		margin: 0;
		overflow-x: auto;
		padding: 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		line-height: 1.6;
		color: var(--code-plain);
		white-space: pre;
		tab-size: 2;
	}
	.codeblock__pre:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	.codeblock__code {
		font-family: inherit;
	}

	.tok--keyword {
		color: var(--code-keyword);
		font-weight: 600;
	}
	.tok--string {
		color: var(--code-string);
	}
	.tok--number {
		color: var(--code-number);
	}
	.tok--function {
		color: var(--code-function);
	}
	.tok--comment {
		color: var(--code-comment);
		font-style: italic;
	}
	.tok--punctuation {
		color: var(--code-punctuation);
	}
	.tok--plain {
		color: var(--code-plain);
	}
</style>
