<!--
  AffectedAlerts — the shared "service alerts affecting this entity" section.

  A surface-agnostic primitive the stop + route detail screens compose to surface
  the LIVE service alerts touching the entity they detail (the caller narrows the
  live alert list with $lib/v1's alertsForStop / alertsForRoute selectors and
  passes the result here, already sorted severity-first). It carries the
  cross-surface alert presentation once:

    - the localized headline per alert via the SAME alertDisplayText() the map
      uses — which prefers the alert's DESCRIPTION (body), then its header text,
      then the header key, then a generic "Service alert" fallback, all chosen by
      locale (see mapAlerts.alertDisplayText);
    - the severity as a glyph + dataviz severity-scale dot (NEVER --primary) with
      a visually-hidden severity word (colour is never the sole channel);
    - the cause / effect via the SHARED gtfsAlertLabels (humanized, bilingual);
    - the active window (start → end) when the feed carries one.

  DOCTRINE (inherited from the surface spine): data marks ride the dataviz scale,
  --primary stays interactive-only. Tokens, no hex. All copy arrives via props —
  no inline literals, no provider/place names. Bilingual heading via the `copy`
  prop.

  CAP / disclosure: a busy stop can serve many route-scoped alerts, so the
  visible list is capped at VISIBLE_CAP. Any overflow is reachable via a "+N more"
  disclosure button — an honest EXPAND, never a silent drop (the hidden alerts
  are one click away, and the full count is named).

  Honesty / empty state: when `alerts` is empty the section STANDS DOWN entirely
  (renders nothing) — matching how the other detail sections (habits / weekday /
  time-of-day) behave. The caller decides whether an explicit "no alerts" note is
  warranted; standing down is the calm default. A null/absent cause, effect or
  window simply omits that line — never a fabricated value.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import type { Alert, SeverityCode } from '$lib/v1/schemas';
	import { formatUtc } from '$lib/utils/time';
	import { SectionLabel } from '@yesid/ui/brand';
	// The contract-level alert helpers, now in the shared $lib/v1 kernel: the
	// bilingual GTFS-RT cause/effect labels + the locale-aware display-text resolver
	// (HTML scrub + generic-header guard). Both are pure + provider-agnostic.
	import { causeLabel, effectLabel } from '$lib/v1/gtfsAlertLabels';
	import { alertDisplayText } from '$lib/v1/alertDisplay';

	/** Localized strings for this section — bilingual heading + the meta captions. */
	export interface AffectedAlertsCopy {
		/** Section heading ("Service alerts" / "Avis de service"). */
		readonly heading: string;
		/** Accessible label for the alert list (defaults to `heading` when omitted). */
		readonly listLabel?: string;
		/** Cause caption ("Cause"). */
		readonly cause: string;
		/** Effect caption ("Effect" / "Effet"). */
		readonly effect: string;
		/** "From" caption for an alert with a start time. */
		readonly from: string;
		/** "Until" caption for an alert with an end time. */
		readonly until: string;
		/** Visually-hidden severity words, keyed by SeverityCode (a11y). */
		readonly severity: Record<SeverityCode, string>;
		/** "+N more" disclosure label when the list overflows the visible cap. */
		readonly more: (n: number) => string;
		/** Label to collapse the expanded list back to the capped view. */
		readonly showLess: string;
	}

	interface Props {
		/** The alerts affecting this entity (already filtered + sorted by the caller). */
		alerts: readonly Alert[];
		/** Active UI locale. */
		locale: Locale;
		/** Localized copy for the heading + meta captions. */
		copy: AffectedAlertsCopy;
		/**
		 * Optional `data-testid` for the section root, so a host's tests can scope
		 * to this block (e.g. "stop-alerts" / "route-alerts"). `slot` is a reserved
		 * attribute, so we take a plain prop and render it as `data-testid`.
		 */
		testId?: string;
	}

	let { alerts, locale, copy, testId }: Props = $props();

	const listLabel = $derived(copy.listLabel ?? copy.heading);
	// A stable per-instance id so the disclosure button's aria-controls targets
	// this section's list (multiple AffectedAlerts can coexist on a page).
	const uid = $props.id();
	const listId = `affected-alerts-${uid}`;

	/**
	 * The visible-alert cap. A busy stop serves many route-scoped alerts; we show
	 * the most-severe handful and disclose the rest behind a "+N more" button so
	 * the section never becomes a wall. The alerts arrive severity-sorted, so the
	 * cap keeps the highest-severity ones visible.
	 */
	const VISIBLE_CAP = 4;
	let expanded = $state(false);

	// Reset the disclosure whenever the alert set changes (e.g. on navigation to
	// another entity) so a stale "expanded" never carries over.
	$effect(() => {
		void alerts;
		expanded = false;
	});

	const overflow = $derived(Math.max(0, alerts.length - VISIBLE_CAP));
	const visibleAlerts = $derived(
		expanded || overflow === 0 ? alerts : alerts.slice(0, VISIBLE_CAP),
	);

	/** Glyph per severity — colour is never the sole channel (mirrors dataviz doctrine). */
	const SEVERITY_GLYPH: Record<SeverityCode, string> = {
		critical: '◆',
		high: '▲',
		watch: '○',
	};

	function headline(alert: Alert): string {
		return alertDisplayText(alert, locale);
	}

	/** A localized wall-clock time for an alert-window bound, or null when absent. */
	function windowTime(iso: string | null | undefined): string | null {
		if (iso == null) return null;
		const text = formatUtc(iso, locale);
		// formatUtc returns the no-data middot for invalid input — drop it here so a
		// bad timestamp omits the line rather than printing a bare "·".
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
				<li class="affected-alert" data-severity={alert.severity}>
					<p class="affected-alert-head">
						<span class="affected-alert-dot" aria-hidden="true">
							{SEVERITY_GLYPH[alert.severity]}
						</span>
						<span class="sr-only">{copy.severity[alert.severity]}</span>
						<span class="affected-alert-title">{headline(alert)}</span>
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
				</li>
			{/each}
		</ul>
		{#if overflow > 0}
			<!-- Honest disclosure: the overflow is one click away, never silently
			     dropped. The button names the hidden count and toggles the full list. -->
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
	/* "+N more" disclosure — an INTERACTION control, so --primary belongs here
	   (never on a data mark). A quiet text button that reveals the capped overflow. */
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
	/* Each alert is a card whose severity reads from its tinted border + surface
	   on the dataviz severity scale (P7: no leading stripe rail). */
	.affected-alert {
		--alert-tone: var(--dataviz-severity-high);
		position: relative;
		margin: 0;
		border: 1px solid color-mix(in srgb, var(--alert-tone) 32%, var(--border) 68%);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--alert-tone) 9%, var(--card));
		padding: 0.625rem 0.75rem;
		overflow: hidden;
	}
	.affected-alert[data-severity='critical'] {
		--alert-tone: var(--dataviz-severity-critical);
	}
	.affected-alert[data-severity='high'] {
		--alert-tone: var(--dataviz-severity-high);
	}
	.affected-alert[data-severity='watch'] {
		--alert-tone: var(--dataviz-severity-watch);
	}
	.affected-alert-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0;
	}
	.affected-alert-dot {
		flex: none;
		font-size: var(--text-small);
		line-height: 1.2;
		color: var(--alert-tone);
		font-variant-emoji: text;
	}
	.affected-alert-title {
		min-width: 0;
		font-size: var(--text-small);
		font-weight: 500;
		line-height: 1.35;
		color: var(--foreground);
	}
	/* Cause / effect / window — a labeled mono caption block under the headline,
	   tinted by the alert's own severity tone so it reads as one signage unit. */
	.affected-alert-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 0.75rem;
		margin: 0.5rem 0 0;
	}
	.affected-alert-meta div {
		display: inline-flex;
		align-items: baseline;
		gap: 0.375rem;
		min-width: 0;
	}
	.affected-alert-meta dt {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: color-mix(in srgb, var(--alert-tone) 70%, var(--muted-foreground));
	}
	.affected-alert-meta dd {
		margin: 0;
		min-width: 0;
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--foreground);
	}
	/* Visually-hidden severity word — readable by assistive tech, invisible on
	   screen, so colour + glyph are never the sole severity channel. */
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
