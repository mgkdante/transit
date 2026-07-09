<!--
  AlertLog — the chronological alert-log PRESENTER (S15 de-monolith).

  A pure view over the already-filtered, already-built {@link AlertRowVM} rows: the
  severity-coded card list + the "+N more" disclosure. All logic (banding, window
  clipping, VM build) lives in the orchestrator + selectors; this file only renders.

  HONESTY: a null field is OMITTED (never a fabricated 0). A row with >1 active
  window lists them all under a "Service windows" header (the D1 citizen win); a
  single-window row renders the familiar From/Until pair. A present url is a SAFE
  external link (rel noopener, hostname shown). Colour + glyph are never the sole
  channel — the visually-hidden severity word rides every row.
-->
<script lang="ts">
	import type { AlertHistoryCopy } from '../alerts.copy';
	import type { AlertRowVM } from '../selectors/alertLog';
	import type { SeverityCode } from '$lib/v1/schemas';

	interface Props {
		/** The rows to render (already filtered + capped by the orchestrator). */
		rows: readonly AlertRowVM[];
		/** Total matched rows (for the overflow disclosure + count caption). */
		total: number;
		/** True when the log is expanded past the visible cap. */
		expanded: boolean;
		/** How many rows overflow the cap (0 = no disclosure). */
		overflow: number;
		/** DOM id for the list (the disclosure's aria-controls). */
		logId: string;
		copy: AlertHistoryCopy;
		/** Toggle the +N-more disclosure. */
		onToggle: () => void;
	}
	let { rows, total, expanded, overflow, logId, copy, onToggle }: Props = $props();

	/** Glyph per severity — colour is never the sole channel (mirrors AffectedAlerts). */
	const SEVERITY_GLYPH: Record<SeverityCode, string> = {
		critical: '◆',
		high: '▲',
		watch: '○',
	};
</script>

<ul id={logId} class="alert-history-log" aria-label={copy.logListLabel} data-slot="alert-log">
	{#each rows as row (row.id)}
		<li class="alert-history-row" data-severity={row.severity} data-slot="alert-row">
			<p class="alert-history-row-head">
				<span class="alert-history-dot" aria-hidden="true">{SEVERITY_GLYPH[row.severity]}</span>
				<span class="sr-only">{copy.severity[row.severity]}</span>
				<span class="alert-history-title">{row.headline}</span>
			</p>
			<dl class="alert-history-meta">
				{#if row.periods.length > 1}
					<!-- MULTI-WINDOW (D1): list every active window under one honest header. -->
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
				{#if row.impactPassages != null}
					<div>
						<dt>{copy.meta.impact}</dt>
						<dd>{copy.meta.impactValue(row.impactPassages)}</dd>
					</div>
				{/if}
			</dl>
			{#if row.url}
				<!-- A present url as a SAFE external link (http/https only, hostname shown). -->
				<p class="alert-history-link">
					<a
						href={row.url.href}
						target="_blank"
						rel="noopener noreferrer"
						data-slot="alert-link"
						aria-label={copy.meta.linkAria(row.url.host)}
					>
						{copy.meta.link} · {row.url.host}
					</a>
				</p>
			{/if}
		</li>
	{/each}
</ul>

{#if overflow > 0}
	<!-- Honest disclosure: the overflow is one click away, never silently dropped.
	     --primary belongs here (an interaction control). -->
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

<!-- The count caption is owned by the orchestrator head; total threaded for the a11y
     live region below stays minimal. -->
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
	/* Each past alert is a card whose severity reads from its tinted border +
	   surface on the dataviz severity scale (P7: no leading stripe rail). */
	.alert-history-row {
		--alert-tone: var(--dataviz-severity-watch);
		position: relative;
		margin: 0;
		border: 1px solid color-mix(in srgb, var(--alert-tone) 32%, var(--border) 68%);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--alert-tone) 9%, var(--card));
		padding: 0.625rem 0.75rem;
		overflow: hidden;
	}
	.alert-history-row[data-severity='critical'] {
		--alert-tone: var(--dataviz-severity-critical);
	}
	.alert-history-row[data-severity='high'] {
		--alert-tone: var(--dataviz-severity-high);
	}
	.alert-history-row[data-severity='watch'] {
		--alert-tone: var(--dataviz-severity-watch);
	}
	.alert-history-row-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0;
	}
	.alert-history-dot {
		flex: none;
		font-size: var(--text-small);
		line-height: 1.2;
		color: var(--alert-tone);
		font-variant-emoji: text;
	}
	.alert-history-title {
		min-width: 0;
		font-size: var(--text-small);
		font-weight: 500;
		line-height: 1.35;
		color: var(--foreground);
	}
	/* Window / duration / reach / impact — a labeled mono caption block, tinted by
	   the alert's own severity tone so it reads as one signage unit. */
	.alert-history-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 0.75rem;
		margin: 0.5rem 0 0;
	}
	.alert-history-meta > div {
		display: inline-flex;
		align-items: baseline;
		gap: 0.375rem;
		min-width: 0;
	}
	.alert-history-meta dt {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: color-mix(in srgb, var(--alert-tone) 70%, var(--muted-foreground));
	}
	.alert-history-meta dd {
		margin: 0;
		min-width: 0;
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
	}
	/* Multi-window list: the header row + a bulleted list of each active range. */
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
	/* External details link — an INTERACTION affordance (--primary). */
	.alert-history-link {
		margin: 0.375rem 0 0;
	}
	.alert-history-link a {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 0.2em;
		word-break: break-all;
	}
	.alert-history-link a:hover {
		text-decoration-thickness: 2px;
	}
	.alert-history-link a:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}
	/* "+N more" disclosure — an INTERACTION control, so --primary belongs here. */
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
	/* Visually-hidden severity word / live region — colour + glyph never the sole channel. */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
