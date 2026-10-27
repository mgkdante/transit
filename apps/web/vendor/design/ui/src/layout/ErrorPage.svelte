<!--
  Error route body: hazard rule, construction scene, label, heading, body, suggested
  destinations and a terminal status line. The scene shows its 404 sign only for 404s; other
  statuses also announce the numeric status. The app owns copy and <svelte:head>.
-->
<script lang="ts" module>
	export interface ErrorPageLink {
		href: string;
		label: string;
	}

	export interface ErrorPageProps {
		status: number;
		label: string;
		heading: string;
		body: string;
		/** The first link is styled as the primary destination. */
		suggestions?: readonly ErrorPageLink[];
		/** Accessible name of the suggestions navigation. */
		suggestionsLabel?: string;
		/** Comment after `$ route --status <status>`; the terminal line renders only when given. */
		statusNote?: string;
		/** Technical detail, such as the error message. */
		detail?: string;
		/** Small text on the scene's sign. */
		signLabel?: string;
	}
</script>

<script lang="ts">
	import { Separator } from '../primitives/separator/index.js';
	import ErrorIllustration from '../brand/ErrorIllustration.svelte';
	import SectionLabel from '../brand/SectionLabel.svelte';
	import TerminalCursor from '../brand/TerminalCursor.svelte';

	let {
		status,
		label,
		heading,
		body,
		suggestions = [],
		suggestionsLabel,
		statusNote,
		detail,
		signLabel,
	}: ErrorPageProps = $props();

	const notFound = $derived(status === 404);
</script>

<section class="error-page" data-slot="error-page">
	<div data-testid="hazard-tape">
		<Separator variant="hazard" maxWidth="none" />
	</div>

	<div class="error-page-content">
		<div class="error-illustration">
			<ErrorIllustration code={notFound ? String(status) : undefined} {signLabel} />
		</div>

		<div class="error-copy">
			<div data-testid="error-label">
				<SectionLabel text={label} variant="station" align="center" />
			</div>
			{#if !notFound}
				<p class="error-status" role="alert">
					<span class="error-glyph" aria-hidden="true">◆</span>
					<span class="error-code">{status}</span>
				</p>
			{/if}
			<h1>{heading}</h1>
			<p class="error-body">{body}</p>
			{#if detail}
				<p class="error-detail">{detail}</p>
			{/if}
		</div>

		{#if suggestions.length > 0}
			<nav class="suggestions" aria-label={suggestionsLabel}>
				{#each suggestions as suggestion, index (suggestion.href)}
					<a
						href={suggestion.href}
						data-testid="error-suggestion-link"
						class:suggestion-primary={index === 0}
						class:suggestion-secondary={index > 0}
					>
						<span class:dot-solid={index === 0} class:dot-hollow={index > 0} aria-hidden="true"
						></span>
						{suggestion.label}
					</a>
				{/each}
			</nav>
		{/if}

		{#if statusNote}
			<p class="terminal-line" data-testid="terminal-line">
				<span class="terminal-command">$</span>
				<span> route --status</span>
				<span class="terminal-command"> {status}</span>
				<span class="terminal-note"> {statusNote}</span>
				<TerminalCursor class="error-terminal-cursor" />
			</p>
		{/if}
	</div>
</section>

<style>
	.error-page {
		width: 100%;
		min-height: calc(100dvh - 5rem);
		padding-inline: var(--space-page-x);
		display: flex;
		flex-direction: column;
	}

	.error-page-content {
		width: 100%;
		max-width: 52rem;
		margin-inline: auto;
		padding-block: 1rem;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.25rem;
	}

	.error-illustration {
		width: 100%;
		max-width: 24rem;
	}

	.error-copy {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		text-align: center;
	}

	.error-copy h1 {
		max-width: 32rem;
		margin: 0;
		font-family: var(--font-heading);
		font-size: 1.5rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--foreground);
	}

	.error-body {
		max-width: 28rem;
		margin: 0;
		font-size: 1rem;
		line-height: 1.625;
		color: var(--secondary-foreground);
	}

	.error-status {
		margin: 0;
		display: inline-flex;
		align-items: baseline;
		gap: 0.75rem;
		font-family: var(--font-mono);
		font-size: var(--text-title);
		line-height: 1;
	}

	.error-glyph {
		color: var(--destructive);
	}

	.error-code {
		font-weight: 700;
		color: var(--foreground);
	}

	.error-detail {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		word-break: break-word;
		color: var(--muted-foreground);
	}

	.suggestions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.75rem;
	}

	.suggestions a {
		min-height: 2.75rem;
		padding: 0.625rem 1.25rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		border: 1px solid;
		border-radius: var(--radius-pill);
		font-family: var(--font-body);
		font-size: 0.875rem;
		font-weight: 500;
		text-decoration: none;
		transition:
			border-color var(--duration-normal) var(--ease-default),
			background var(--duration-normal) var(--ease-default),
			color var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-default);
	}

	.suggestions a:hover {
		transform: scale(1.03);
	}

	.suggestions a:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 3px;
	}

	.suggestion-primary {
		border-color: color-mix(in srgb, var(--primary) 30%, transparent);
		background: color-mix(in srgb, var(--primary) 8%, transparent);
		color: var(--primary);
	}

	.suggestion-primary:hover {
		border-color: color-mix(in srgb, var(--primary) 60%, transparent);
		background: color-mix(in srgb, var(--primary) 15%, transparent);
	}

	.suggestion-secondary {
		border-color: color-mix(in srgb, var(--foreground) 10%, transparent);
		background: color-mix(in srgb, var(--foreground) 3%, transparent);
		color: var(--secondary-foreground);
	}

	.suggestion-secondary:hover {
		border-color: color-mix(in srgb, var(--primary) 40%, transparent);
		color: var(--primary);
	}

	.suggestions a > span {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		transition:
			border-color var(--duration-normal) var(--ease-default),
			background var(--duration-normal) var(--ease-default);
	}

	.dot-solid {
		background: var(--primary);
	}

	.dot-hollow {
		border: 1.5px solid var(--border-subtle);
		background: transparent;
	}

	.suggestion-secondary:hover .dot-hollow {
		border-color: var(--primary);
		background: var(--primary);
	}

	.terminal-line {
		max-width: 100%;
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		line-height: 1.5;
		text-align: center;
		color: var(--secondary-foreground);
	}

	.terminal-command {
		color: var(--primary);
	}

	.terminal-note {
		color: var(--muted-foreground);
	}

	:global(.error-terminal-cursor.error-terminal-cursor) {
		background: var(--accent);
	}

	:global([data-theme='light'] .error-terminal-cursor.error-terminal-cursor) {
		background: var(--accent-text);
	}

	@media (min-width: 640px) {
		.error-page-content {
			gap: 1.5rem;
		}
		.error-illustration {
			max-width: 28rem;
		}
		.error-copy {
			gap: 0.75rem;
		}
		.error-copy h1 {
			font-size: 2.25rem;
		}
		.error-body {
			font-size: 1.125rem;
		}
		.suggestions a {
			font-size: 1rem;
		}
		.terminal-line {
			font-size: 0.875rem;
		}
	}

	@media (max-width: 399px) {
		.terminal-note {
			display: block;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.suggestions a,
		.suggestions a > span {
			transition: none;
		}
		.suggestions a:hover {
			transform: none;
		}
	}
</style>
