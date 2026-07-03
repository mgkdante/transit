<!--
  CodeBlock — yesid.dev code-snippet treatment for a verbatim SQL/code block.

  Gives the explainer's Defining SQL the brand code chrome: a language tag, a
  surface/border register, and dependency-free syntax highlighting (keywords /
  strings / numbers / functions / comments). No highlighter dep is in the tree,
  so the tokenizer is hand-rolled here (a keyword set + a single ordered regex).

  DOCTRINE: the syntax palette is a set of theme-aware CSS custom properties
  LOCAL to this component (a light + dark pair keyed off [data-theme]), NOT
  global tokens — so the highlight reads correctly in both themes without
  touching tokens.json/tokens.css. The chrome (border, --card surface, the mono
  language tag) reuses existing global tokens. No data marks, no --primary on the
  code itself; the block is keyboard-scrollable so overflow is pointer-free.
-->
<script lang="ts">
	import { tokenizeSql, type CodeToken } from './sql-highlight';

	interface CodeBlockProps {
		/** The verbatim source to render. Language-neutral; highlighting is SQL-aware. */
		code: string;
		/** Language label shown in the chrome tag (e.g. "SQL"). Default 'SQL'. */
		lang?: string;
		/** Accessible label for the scrollable code region. */
		ariaLabel?: string;
		/** Extra classes on the figure wrapper. */
		class?: string;
	}

	let { code, lang = 'SQL', ariaLabel, class: className }: CodeBlockProps = $props();

	const tokens: CodeToken[] = $derived(tokenizeSql(code));
</script>

<figure class={`codeblock ${className ?? ''}`}>
	<figcaption class="codeblock__chrome">
		<span class="codeblock__lang">{lang}</span>
	</figcaption>
	<!-- Scrollable code region: keyboard-focusable so the overflow is reachable
	     without a pointer (mirrors the dataviz scrollable-region pattern). -->
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
	/* Theme-aware syntax palette — LOCAL custom properties (not global tokens).
	   Dark is the default register; the light pair re-pins for AA on warm paper. */
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

	/* Light theme re-pin — darker, AA-readable hues on the paper card. */
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
		font-size: var(--text-caption);
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
