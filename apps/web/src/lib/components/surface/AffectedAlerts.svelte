<script lang="ts">
	import '#lib/components/surface/alert-item.css';
	import type { Locale } from '#lib/i18n/index.ts';
	import type { Alert, SeverityCode } from '#lib/v1/schemas/index.ts';
	import { formatUtc } from '#lib/utils/time.ts';
	import { SectionLabel } from '@yesid/ui/brand';
	import { causeLabel, effectLabel } from '#lib/v1/gtfsAlertLabels.ts';
	import { alertDisplayText, alertDisplayUrl, alertLanguageNotice } from '#lib/v1/alertDisplay.ts';

	export interface AffectedAlertsCopy {
		readonly heading: string;
		readonly listLabel?: string;
		readonly cause: string;
		readonly effect: string;
		readonly from: string;
		readonly until: string;
		readonly severity: Record<SeverityCode, string>;
		readonly more: (n: number) => string;
		readonly showLess: string;
		readonly link: string;
		readonly linkAria: (host: string) => string;
	}

	interface Props {
		alerts: readonly Alert[];
		locale: Locale;
		copy: AffectedAlertsCopy;
		testId?: string;
	}

	let { alerts, locale, copy, testId }: Props = $props();

	const listLabel = $derived(copy.listLabel ?? copy.heading);
	const uid = $props.id();
	const listId = `affected-alerts-${uid}`;

	const VISIBLE_CAP = 4;
	let expanded = $state(false);

	$effect(() => {
		void alerts;
		expanded = false;
	});

	const overflow = $derived(Math.max(0, alerts.length - VISIBLE_CAP));
	const visibleAlerts = $derived(
		expanded || overflow === 0 ? alerts : alerts.slice(0, VISIBLE_CAP),
	);

	const SEVERITY_GLYPH: Record<SeverityCode, string> = {
		critical: '◆',
		high: '▲',
		watch: '○',
	};

	function headline(alert: Alert) {
		return alertDisplayText(alert, locale);
	}

	function windowTime(iso: string | null | undefined): string | null {
		if (iso == null) return null;
		const text = formatUtc(iso, locale);
		return text === '·' ? null : text;
	}
</script>

{#if alerts.length > 0}
	<section class="affected-alerts" data-testid={testId ?? 'affected-alerts'}>
		<SectionLabel text={copy.heading} variant="metric" />
		<ul id={listId} class="affected-alerts-list" aria-label={listLabel}>
			{#each visibleAlerts as alert (alert.id)}
				{@const cause = causeLabel(alert.cause, locale)}
				{@const effect = effectLabel(alert.effect, locale)}
				{@const from = windowTime(alert.start_utc)}
				{@const until = windowTime(alert.end_utc)}
				{@const title = headline(alert)}
				{@const marker = alertLanguageNotice(title, locale)}
				{@const url = alertDisplayUrl(alert, locale)}
				<li class="affected-alert" data-severity={alert.severity}>
					<p class="affected-alert-head">
						<span class="affected-alert-dot" aria-hidden="true">
							{SEVERITY_GLYPH[alert.severity]}
						</span>
						<span class="sr-only">{copy.severity[alert.severity]}</span>
						<span class="affected-alert-title">
							<span lang={title.lang ?? ''}>{title.text}</span>
							{#if marker}
								<span class="alert-language-marker">{marker}</span>
							{/if}
						</span>
					</p>
					{#if cause || effect || from || until}
						<dl class="affected-alert-meta">
							{#if cause}
								<div>
									<dt>{copy.cause}</dt>
									<dd>{cause}</dd>
								</div>
							{/if}
							{#if effect}
								<div>
									<dt>{copy.effect}</dt>
									<dd>{effect}</dd>
								</div>
							{/if}
							{#if from}
								<div>
									<dt>{copy.from}</dt>
									<dd>{from}</dd>
								</div>
							{/if}
							{#if until}
								<div>
									<dt>{copy.until}</dt>
									<dd>{until}</dd>
								</div>
							{/if}
						</dl>
					{/if}
					{#if url}
						<p class="affected-alert-link">
							<a
								href={url.href}
								hreflang={url.lang ?? undefined}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={copy.linkAria(url.host)}
							>
								{copy.link} · {url.host}
							</a>
							{#if alertLanguageNotice(url, locale)}
								<span class="alert-language-marker">{alertLanguageNotice(url, locale)}</span>
							{/if}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
		{#if overflow > 0}
			<button
				type="button"
				class="affected-alerts-more"
				aria-expanded={expanded}
				aria-controls={listId}
				onclick={() => (expanded = !expanded)}
			>
				{expanded ? copy.showLess : copy.more(overflow)}
			</button>
		{/if}
	</section>
{/if}

<style>
	.affected-alerts {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.affected-alerts-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.affected-alerts-more {
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
	.affected-alerts-more:hover {
		text-decoration-thickness: 2px;
	}
	.affected-alerts-more:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}
</style>
