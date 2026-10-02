<script lang="ts">
	import type { Snippet } from 'svelte';
	import { boop } from '@yesid/motion';
	import { CornerMarks } from '$lib/components/brand';
	import ManifestoCanvas from '$lib/components/brand/ManifestoCanvas.svelte';

	export interface ArticleHeaderProps {
		watermark: string;
		category: string;
		title: string;
		tags: readonly string[];
		tagsAria: string;
		backHref: string;
		backLabel: string;
		meta: readonly ArticleMetaEntry[];
		metaPending?: boolean;
		accent?: string;
		actions?: Snippet;
		controls?: Snippet;
		edgeLeft?: string;
		edgeRight?: string;
		titleId?: string;
	}

	export type ArticleMetaEntry =
		| string
		| {
				readonly text: string;
				readonly datetime?: string;
				readonly label?: string;
		  };

	let {
		watermark,
		category,
		title,
		tags,
		tagsAria,
		backHref,
		backLabel,
		meta,
		metaPending = false,
		accent = 'var(--primary)',
		actions,
		controls,
		edgeLeft,
		edgeRight,
		titleId,
	}: ArticleHeaderProps = $props();

	let headerEl = $state<HTMLElement>(undefined!);

	const titleParts = $derived.by(() => {
		const keyword = tags[0];
		if (!keyword) return [{ text: title, highlight: false }];
		const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
		const match = title.match(regex);
		if (!match || match.index === undefined) return [{ text: title, highlight: false }];

		const parts: { text: string; highlight: boolean }[] = [];
		if (match.index > 0) parts.push({ text: title.slice(0, match.index), highlight: false });
		parts.push({ text: match[1], highlight: true });
		const after = title.slice(match.index + match[1].length);
		if (after) parts.push({ text: after, highlight: false });
		return parts;
	});
</script>

<div
	bind:this={headerEl}
	class="article-header"
	style="--article-accent: {accent};"
	data-slot="article-header"
>
	<div class="header__circuit-grid detail-header-grid" aria-hidden="true"></div>
	<ManifestoCanvas containerEl={headerEl} />

	<section class="header-section w-full">
		<div class="absolute inset-0 pointer-events-none overflow-hidden">
			<CornerMarks size="md" opacity={0.12} />

			<div
				class="header__decoration absolute right-[55px] top-[70px] hidden items-center gap-1.5 lg:flex"
				aria-hidden="true"
			>
				{#each Array(3) as _, i (i)}
					<div
						class="h-3.5 w-3.5 rotate-[-45deg] border-b-2 border-r-2"
						style="border-color: var(--article-accent);"
					></div>
				{/each}
			</div>

			<div class="header__watermark" aria-hidden="true">
				{watermark}
			</div>

			{#if edgeLeft}
				<div class="header__edge header__edge-left hidden lg:block" aria-hidden="true">
					{edgeLeft}
				</div>
			{/if}
			{#if edgeRight}
				<div class="header__edge header__edge-right hidden lg:block" aria-hidden="true">
					{edgeRight}
				</div>
			{/if}
		</div>

		<div class="header__content">
			<a href={backHref} class="header__back" use:boop={{ scale: 1.05, timing: 200 }}>
				{backLabel}
			</a>

			<div class="header__cat-line">
				{category}
			</div>

			<h1 class="header__title" id={titleId}>
				{#each titleParts as part, i (i)}
					{#if part.highlight}<span class="header__title-highlight">{part.text}</span
						>{:else}{part.text}{/if}
				{/each}
			</h1>

			<ul class="header__tags" aria-label={tagsAria}>
				{#each tags as tag (tag)}
					<li class="header__pill">{tag}</li>
				{/each}
			</ul>

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
		position: relative;
		--header-accent: var(--article-accent);
		margin-top: calc(-2 * var(--chrome-offset));
		padding-top: var(--chrome-offset);
		overflow: hidden;
		background: var(--manifesto);
		cursor: crosshair;
	}

	.header-section {
		position: relative;
		display: grid;
		align-items: center;
		min-height: 380px;
	}
	@media (min-width: 1024px) {
		.header-section {
			min-height: 440px;
		}
	}

	.header__circuit-grid {
		position: absolute;
		inset: 0;
		z-index: var(--z-base);
	}

	.header__watermark {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: clamp(100px, 14vw, 180px);
		font-weight: 900;
		color: color-mix(in srgb, var(--article-accent) 2.5%, transparent);
		text-transform: uppercase;
		letter-spacing: -0.06em;
		pointer-events: none;
		white-space: nowrap;
		z-index: var(--z-base);
	}

	.header__edge {
		position: absolute;
		top: 50%;
		z-index: calc(var(--z-content) + 1);
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 2px;
		color: var(--article-accent);
		opacity: var(--chrome-ink-opacity);
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

	.header__decoration {
		z-index: calc(var(--z-content) + 1);
	}

	.header__content {
		position: relative;
		z-index: calc(var(--z-content) + 9);
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		width: 100%;
		margin-inline: auto;
		padding: var(--chrome-offset) 1.25rem 2.5rem;
	}
	@media (min-width: 1024px) {
		.header__content {
			padding: var(--chrome-offset) 2rem 3.75rem;
		}
	}

	.header__back {
		display: inline-block;
		margin-bottom: 1.25rem;
		font-family: var(--font-mono);
		font-size: var(--text-back-link, var(--text-small));
		letter-spacing: 0;
		color: color-mix(in srgb, var(--article-accent) 60%, var(--foreground));
		text-decoration: none;
		transition: color var(--duration-normal) ease;
	}
	.header__back:hover {
		color: var(--foreground);
	}
	@media (min-width: 1024px) {
		.header__back {
			margin-bottom: 1.75rem;
		}
	}

	.header__actions,
	.header__controls {
		margin-top: 1.25rem;
		display: flex;
		width: 100%;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}
	.header__actions + .header__controls {
		margin-top: 0.75rem;
	}

	.header__cat-line {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		margin-bottom: 1.25rem;
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 3px;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--article-accent) 60%, var(--foreground));
		max-width: calc(100% - 2rem);
	}
	.header__cat-line::before,
	.header__cat-line::after {
		content: '';
		width: 40px;
		height: 1px;
		background: color-mix(in srgb, var(--article-accent) 30%, transparent);
	}
	@media (min-width: 1024px) {
		.header__cat-line {
			margin-bottom: 1.5rem;
		}
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

	.header__title {
		font-family: var(--font-heading);
		font-size: clamp(26px, 4.5vw, 48px);
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: -0.04em;
		line-height: 0.95;
		color: var(--foreground);
		margin-bottom: 1.25rem;
	}
	.header__title-highlight {
		color: var(--article-accent);
	}
	.header__tags {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		margin-top: 0;
		margin-bottom: 1.25rem;
		padding: 0;
		list-style: none;
	}
	@media (min-width: 1024px) {
		.header__tags {
			gap: 8px;
		}
	}
	.header__pill {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.04em;
		color: color-mix(in srgb, var(--article-accent) 60%, var(--foreground));
		border: 1px solid color-mix(in srgb, var(--article-accent) 12%, transparent);
		border-radius: var(--radius-pill);
		padding: 4px 12px;
		background: color-mix(in srgb, var(--article-accent) 3%, transparent);
	}
	@media (min-width: 1024px) {
		.header__pill {
			font-size: var(--text-caption);
			border-color: color-mix(in srgb, var(--article-accent) 15%, transparent);
			padding: 7px 18px;
			background: color-mix(in srgb, var(--article-accent) 4%, transparent);
		}
	}

	.header__meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		min-height: 1rem;
		font-family: var(--font-mono);
		font-size: clamp(9px, 2.8vw, 11px);
		color: color-mix(in srgb, var(--article-accent) 60%, var(--foreground));
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

	:global(.manifesto__ripple) {
		position: absolute;
		border: 1px solid color-mix(in srgb, var(--primary) 40%, transparent);
		border-radius: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: calc(var(--z-content) + 3);
		animation: ripple-expand 1.2s ease-out forwards;
	}
	:global(.manifesto__ripple-inner) {
		position: absolute;
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		border-radius: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: calc(var(--z-content) + 3);
		animation: ripple-inner 0.8s ease-out forwards;
	}
	@keyframes ripple-expand {
		0% {
			width: 0;
			height: 0;
			opacity: 0.6;
		}
		100% {
			width: 200px;
			height: 200px;
			opacity: 0;
		}
	}
	@keyframes ripple-inner {
		0% {
			width: 0;
			height: 0;
			opacity: 0.8;
		}
		100% {
			width: 100px;
			height: 100px;
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.header__back {
			transition: none;
		}
		:global(.manifesto__ripple),
		:global(.manifesto__ripple-inner) {
			animation: none;
			display: none;
		}
	}
</style>
