<!--
  Article and project page header: circuit-grid band with decorative chrome, a back link, an
  optional category line, the title (one keyword accented), subtitle, meta row, and actions and
  controls snippets. It sits under the fixed site chrome: it cancels the page's top padding of
  `--chrome-offset` and pads itself by the same amount. An app whose offset leaves a gap under its
  chrome sets `--chrome-gap` to it, so the back link sits midway between the chrome and the next line.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export type ArticleMetaEntry =
		| string
		| {
				readonly text: string;
				readonly datetime?: string;
				readonly label?: string;
		  };

	export interface ArticleHeaderProps {
		title: string;
		/** First case-insensitive match in the title renders in the accent. */
		highlight?: string;
		category?: string;
		subtitle?: string;
		backHref: string;
		backLabel: string;
		meta?: readonly ArticleMetaEntry[];
		/** Shows a placeholder while meta is still loading. */
		metaPending?: boolean;
		accent?: string;
		/** Large faint text behind the title. */
		watermark?: string;
		edgeLeft?: string;
		edgeRight?: string;
		/** Extra decorative chrome, rendered in the aria-hidden decoration layer. */
		decorations?: Snippet;
		/** Replaces the default ManifestoCanvas; receives the header element once it is bound (undefined before). */
		canvas?: Snippet<[HTMLElement | undefined]>;
		actions?: Snippet;
		controls?: Snippet;
		titleId?: string;
		testId?: string;
	}
</script>

<script lang="ts">
	import { boop } from '@yesid/motion/actions';
	import CornerMarks from '../brand/CornerMarks.svelte';
	import ManifestoCanvas from '../brand/ManifestoCanvas.svelte';

	let {
		title,
		highlight,
		category,
		subtitle,
		backHref,
		backLabel,
		meta = [],
		metaPending = false,
		accent = 'var(--primary)',
		watermark,
		edgeLeft,
		edgeRight,
		decorations,
		canvas,
		actions,
		controls,
		titleId,
		testId,
	}: ArticleHeaderProps = $props();

	let headerEl = $state<HTMLElement>();

	const titleParts = $derived.by(() => {
		if (!highlight) return [{ text: title, highlight: false }];
		const at = title.toLowerCase().indexOf(highlight.toLowerCase());
		if (at < 0) return [{ text: title, highlight: false }];
		const end = at + highlight.length;
		return [
			{ text: title.slice(0, at), highlight: false },
			{ text: title.slice(at, end), highlight: true },
			{ text: title.slice(end), highlight: false },
		].filter((part) => part.text);
	});
</script>

<div
	bind:this={headerEl}
	class="article-header"
	style="--article-accent: {accent};"
	data-slot="article-header"
	data-testid={testId}
>
	<div class="header__circuit-grid" aria-hidden="true"></div>
	{#if canvas}
		{@render canvas(headerEl)}
	{:else}
		<ManifestoCanvas containerEl={headerEl} />
	{/if}

	<section class="header-section">
		<div class="header__decoration-layer" aria-hidden="true">
			<CornerMarks size="md" opacity={0.12} />

			<div class="header__chevrons">
				{#each [0, 1, 2] as i (i)}
					<div class="header__chevron"></div>
				{/each}
			</div>

			{#if watermark}
				<div class="header__watermark">{watermark}</div>
			{/if}
			{#if edgeLeft}
				<div class="header__edge header__edge-left">{edgeLeft}</div>
			{/if}
			{#if edgeRight}
				<div class="header__edge header__edge-right">{edgeRight}</div>
			{/if}
			{@render decorations?.()}
		</div>

		<div class="header__content">
			<a href={backHref} class="header__back" use:boop={{ scale: 1.05, timing: 200 }}>
				{backLabel}
			</a>

			{#if category}
				<div class="header__cat-line">{category}</div>
			{/if}

			<h1 class="header__title" id={titleId}>
				{#each titleParts as part, i (i)}
					{#if part.highlight}<span class="header__title-highlight">{part.text}</span
						>{:else}{part.text}{/if}
				{/each}
			</h1>

			{#if subtitle}
				<p class="header__subtitle">{subtitle}</p>
			{/if}

			{#if meta.length > 0 || metaPending}
				<div class="header__meta" data-pending={metaPending}>
					{#each meta as entry, i (i)}
						<span class="header__meta-item">
							{#if i > 0}<span class="header__meta-sep" aria-hidden="true"></span>{/if}
							{#if typeof entry === 'string'}
								<span>{entry}</span>
							{:else if entry.label}
								<span class="header__meta-pair">
									<span>{entry.label}</span>
									{#if entry.datetime}
										<time datetime={entry.datetime}>{entry.text}</time>
									{:else}
										<span>{entry.text}</span>
									{/if}
								</span>
							{:else if entry.datetime}
								<time datetime={entry.datetime}>{entry.text}</time>
							{:else}
								<span>{entry.text}</span>
							{/if}
						</span>
					{/each}
					{#if meta.length === 0 && metaPending}
						<span class="header__meta-skeleton" aria-hidden="true"></span>
					{/if}
				</div>
			{/if}

			{#if actions}
				<div class="header__actions" data-slot="article-header-actions">
					{@render actions()}
				</div>
			{/if}

			{#if controls}
				<div class="header__controls" data-slot="article-header-controls">
					{@render controls()}
				</div>
			{/if}
		</div>
	</section>
</div>

<style>
	.article-header {
		--article-deco-opacity: 0.25;
		--article-meta-size: clamp(0.75rem, 0.6875rem + 0.3vw, 0.875rem);
		position: relative;
		margin-top: calc(-1 * var(--chrome-offset, 0px));
		padding-top: var(--chrome-offset, 0px);
		overflow: hidden;
		background: var(--manifesto);
		cursor: crosshair;
	}

	.header-section {
		position: relative;
		display: grid;
	}

	.header__circuit-grid {
		position: absolute;
		inset: 0;
		z-index: var(--z-base);
		background-image:
			repeating-linear-gradient(
				90deg,
				color-mix(in srgb, var(--article-accent) 3.5%, transparent) 0px,
				color-mix(in srgb, var(--article-accent) 3.5%, transparent) 1px,
				transparent 1px,
				transparent 80px
			),
			repeating-linear-gradient(
				0deg,
				color-mix(in srgb, var(--article-accent) 3.5%, transparent) 0px,
				color-mix(in srgb, var(--article-accent) 3.5%, transparent) 1px,
				transparent 1px,
				transparent 80px
			);
	}

	.header__circuit-grid::after {
		content: '';
		position: absolute;
		inset: 0;
		background-image:
			radial-gradient(circle 2.5px at 80px 80px, color-mix(in srgb, var(--article-accent) 12%, transparent) 0%, transparent 4px),
			radial-gradient(circle 2px at 160px 160px, color-mix(in srgb, var(--article-accent) 8%, transparent) 0%, transparent 3px),
			radial-gradient(circle 2.5px at 240px 80px, color-mix(in srgb, var(--article-accent) 10%, transparent) 0%, transparent 4px),
			radial-gradient(circle 2px at 80px 240px, color-mix(in srgb, var(--article-accent) 6%, transparent) 0%, transparent 3px);
		background-size: 320px 320px;
	}

	.header__decoration-layer {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		z-index: calc(var(--z-content) + 1);
	}

	.header__chevrons {
		position: absolute;
		top: 70px;
		right: 55px;
		display: none;
		align-items: center;
		gap: 0.375rem;
	}

	.header__chevron {
		width: 0.875rem;
		height: 0.875rem;
		rotate: -45deg;
		border-right: 2px solid var(--article-accent);
		border-bottom: 2px solid var(--article-accent);
	}

	.header__watermark {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: clamp(100px, 14vw, 180px);
		font-weight: 900;
		color: color-mix(in srgb, var(--article-accent) 2%, transparent);
		text-transform: uppercase;
		letter-spacing: -0.06em;
		white-space: nowrap;
	}

	.header__edge {
		position: absolute;
		top: 50%;
		display: none;
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 2px;
		color: var(--article-accent);
		opacity: var(--article-deco-opacity);
		text-transform: uppercase;
		white-space: nowrap;
	}

	.header__edge-left {
		left: 24px;
		transform: translateY(-50%) rotate(-90deg);
	}

	.header__edge-right {
		right: 24px;
		transform: translateY(-50%) rotate(90deg);
	}

	.header__content {
		position: relative;
		z-index: calc(var(--z-content) + 9);
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
		margin-inline: auto;
		padding: max(0px, calc(0.5rem - var(--chrome-gap, 0px))) 1.25rem 1.5rem;
		text-align: center;
	}

	.header__back {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		margin-bottom: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-back-link);
		letter-spacing: 0;
		color: color-mix(in srgb, var(--article-accent) 60%, var(--foreground));
		text-decoration: none;
		transition: color var(--duration-normal) ease;
	}

	.header__back:hover {
		color: var(--foreground);
	}

	.header__cat-line {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		max-width: calc(100% - 2rem);
		margin-bottom: 0.75rem;
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 3px;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--article-accent) 60%, var(--foreground));
	}

	.header__cat-line::before,
	.header__cat-line::after {
		content: '';
		width: 40px;
		height: 1px;
		background: color-mix(in srgb, var(--article-accent) 30%, transparent);
	}

	.header__title {
		margin: 0 0 0.75rem;
		font-family: var(--font-heading);
		font-size: var(--text-title);
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: -0.04em;
		line-height: 0.95;
		color: var(--foreground);
		text-shadow: 0 0 60px color-mix(in srgb, var(--article-accent) 12%, transparent);
	}

	.header__title-highlight {
		color: var(--article-accent);
	}

	.header__subtitle,
	.header__meta {
		font-family: var(--font-mono);
		font-size: var(--article-meta-size);
		color: color-mix(in srgb, var(--article-accent) 60%, var(--foreground));
	}

	.header__subtitle {
		max-width: 720px;
		margin: 0 auto 0.75rem;
		line-height: 1.6;
	}

	.header__meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		min-height: 1rem;
	}

	.header__meta-item {
		display: inline-flex;
		align-items: center;
		gap: 1rem;
		min-width: 0;
	}

	.header__meta-pair {
		display: inline-flex;
		align-items: baseline;
		gap: 0.5em;
		white-space: nowrap;
	}

	.header__meta-skeleton {
		display: block;
		width: clamp(8rem, 18vw, 14rem);
		height: 0.625rem;
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--article-accent) 12%, transparent);
	}

	.header__meta-sep {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--article-accent);
		opacity: 0.4;
	}

	.header__actions,
	.header__controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		margin-top: 0.75rem;
	}

	@media (max-width: 390px) {
		.header__cat-line {
			gap: 0.5rem;
			font-size: 9px;
			letter-spacing: 1.5px;
			line-height: 1.4;
		}

		.header__cat-line::before,
		.header__cat-line::after {
			width: 20px;
		}
	}

	@media (min-width: 1024px) {
		.header__chevrons {
			display: flex;
		}

		.header__edge {
			display: block;
		}

		.header__content {
			padding-inline: 2rem;
			padding-bottom: 2rem;
		}

		.header__cat-line {
			margin-bottom: 1rem;
		}

		.header__title {
			text-shadow: 0 0 80px color-mix(in srgb, var(--article-accent) 12%, transparent);
		}

		.header__subtitle {
			margin-bottom: 1rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.header__back {
			transition: none;
		}
	}
</style>
