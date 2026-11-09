<script lang="ts">
	import '#lib/components/surface/alert-item.css';
	import { alertLanguageNotice } from '#lib/v1/alertDisplay.ts';
	import type { AlertHistoryCopy } from '../alerts.copy';
	import type { AlertRowVM } from '../selectors/alertLog';
	import type { SeverityCode } from '#lib/v1/schemas/index.ts';
	import type { Locale } from '#lib/i18n/index.ts';

	interface Props {
		rows: readonly AlertRowVM[];
		total: number;
		expanded: boolean;
		overflow: number;
		logId: string;
		copy: AlertHistoryCopy;
		locale: Locale;
		onToggle: () => void;
	}
	let { rows, total, expanded, overflow, logId, copy, locale, onToggle }: Props = $props();

	const SEVERITY_GLYPH: Record<SeverityCode, string> = {
		critical: '◆',
		high: '▲',
		watch: '○',
	};
</script>

<ul id={logId} class="alert-history-log" aria-label={copy.logListLabel} data-slot="alert-log">
	{#each rows as row (row.id)}
		{@const marker = alertLanguageNotice(row.headline, locale)}
		<li class="alert-history-row" data-severity={row.severity} data-slot="alert-row">
			<p class="alert-history-row-head">
				<span class="alert-history-dot" aria-hidden="true">{SEVERITY_GLYPH[row.severity]}</span>
				<span class="sr-only">{copy.severity[row.severity]}</span>
				<span class="alert-history-title">
					<span lang={row.headline.lang ?? ''}>
						{row.headline.text}
					</span>
					{#if marker}
						<span class="alert-language-marker">{marker}</span>
					{/if}
				</span>
			</p>
			<dl class="alert-history-meta">
				{#if row.periods.length > 1}
					<div class="alert-history-windows" data-slot="alert-windows">
						<dt>{copy.meta.windows}</dt>
						<dd>
							<span class="alert-history-windows-count">
								{copy.meta.windowsCount(row.periods.length)}
							</span>
							<ul class="alert-history-window-list">
								{#each row.periods as period, i (i)}
									<li>
										{#if period.from}{copy.meta.from} {period.from}{/if}
										{#if period.from && period.until}
											·
										{/if}
										{#if period.until}{copy.meta.until} {period.until}{/if}
									</li>
								{/each}
							</ul>
						</dd>
					</div>
				{:else}
					{@const period = row.periods[0]}
					{#if period?.from}
						<div>
							<dt>{copy.meta.from}</dt>
							<dd>{period.from}</dd>
						</div>
					{/if}
					{#if period?.until}
						<div>
							<dt>{copy.meta.until}</dt>
							<dd>{period.until}</dd>
						</div>
					{/if}
				{/if}
				{#if row.durationMin != null}
					<div>
						<dt>{copy.meta.duration}</dt>
						<dd>{copy.meta.durationValue(row.durationMin)}</dd>
					</div>
				{/if}
				{#if row.routes.length > 0}
					<div>
						<dt>{copy.meta.routes}</dt>
						<dd>{row.routes.join(' · ')}</dd>
					</div>
				{/if}
				{#if row.stops.length > 0}
					<div>
						<dt>{copy.meta.stops}</dt>
						<dd>{row.stops.length}</dd>
					</div>
				{/if}
			</dl>
			{#if row.url}
				<p class="alert-history-link">
					<a
						href={row.url.href}
						hreflang={row.url.lang ?? undefined}
						target="_blank"
						rel="noopener noreferrer"
						data-slot="alert-link"
						aria-label={copy.meta.linkAria(row.url.host)}
					>
						{copy.meta.link} · {row.url.host}
					</a>
					{#if alertLanguageNotice(row.url, locale)}
						<span class="alert-language-marker">{alertLanguageNotice(row.url, locale)}</span>
					{/if}
				</p>
			{/if}
		</li>
	{/each}
</ul>

{#if overflow > 0}
	<button
		type="button"
		class="alert-history-more"
		aria-expanded={expanded}
		aria-controls={logId}
		onclick={onToggle}
	>
		{expanded ? copy.showLess : copy.more(overflow)}
	</button>
{/if}

<span class="sr-only" aria-live="polite">{copy.count(rows.length, total)}</span>

<style>
	.alert-history-log {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
		max-width: 52rem;
	}
	.alert-history-meta dd {
		font-variant-numeric: tabular-nums;
	}
	.alert-history-windows {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex-basis: 100%;
	}
	.alert-history-windows-count {
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--foreground);
	}
	.alert-history-window-list {
		margin: 0.125rem 0 0;
		padding: 0 0 0 1rem;
		list-style: disc;
		font-size: var(--text-caption);
		color: var(--foreground);
	}
	.alert-history-window-list li {
		line-height: 1.35;
	}
	.alert-history-link {
		margin: 0.375rem 0 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		word-break: break-all;
	}
	.alert-history-more {
		align-self: flex-start;
		appearance: none;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		color: var(--primary);
		background: none;
		border: none;
		padding: 0.125rem 0;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.alert-history-more:hover {
		text-decoration-thickness: 2px;
	}
	.alert-history-more:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}
</style>
