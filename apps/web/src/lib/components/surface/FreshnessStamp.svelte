<!--
  FreshnessStamp — the ONE freshness readout for the whole site (slice-9.8 A).

  Two variants over one shared spine, so every surface shows freshness through a
  single component instead of a bespoke per-page chip/stamp:

    variant="live"     — the "LIVE · 12s ago" chip for live surfaces: a flat
                         status dot (green when fresh, amber when stale), the LIVE
                         label, the relative build age, and a
                         "stale" note when the feed is behind its budget.
    variant="updated"  — a CALM neutral "Updated 4 minutes ago" stamp for
                         static/historic surfaces: a non-pulsing neutral dot + the
                         relative age, never "LIVE"/"stale" (a daily document is
                         not live, so the live chip would falsely imply it is).

  The age ALWAYS comes from the centralized, server-anchored, shared-tick
  derivation (freshnessAgeSeconds / freshnessRelative in $lib/v1/freshness): pass
  a `generatedUtc` and the stamp computes the age itself off the shared clock — no
  caller does per-page age math. (A caller that already tracks a ticking age — the
  live store — may pass `ageSeconds` to drive the relative text and the stale dot;
  it overrides the internal derivation for that instance.)

  HONESTY: with no resolvable timestamp the stamp reads the localized "unknown"
  rather than a fabricated value. a11y: the dot carries an sr-only label on the
  live variant; the updated variant's dot is decorative (the text says it all).

  DOCTRINE: the dot rides the dataviz status scale via StatusDot (on_time/caution/
  unknown), never --primary. Tokens, no hex. Bilingual vocabulary lives local.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import { type Locale } from '$lib/i18n';
	import { formatRelativeSeconds, formatUtc } from '$lib/utils/time';
	import { freshnessAgeSeconds } from '$lib/v1/freshness';
	import { sharedClock } from '$lib/stores';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';

	type Variant = 'live' | 'updated';

	export interface FreshnessStampProps {
		/** ISO 8601 (UTC) build timestamp, or null when unknown (→ "unknown"). */
		generatedUtc: string | null;
		/**
		 * Pre-computed ticking age in seconds. OPTIONAL — when omitted the stamp
		 * derives the age itself from `generatedUtc` off the shared clock (the common
		 * case). The live store passes its own `ageSeconds` to drive the readout.
		 */
		ageSeconds?: number | null;
		/**
		 * Caller-owned replacement for the relative age. When set it wins over every
		 * derivation — the map passes its "not responding" verdict here so a stalled
		 * feed reads as a fact instead of an age (M6f-2 F14). The caller owns the
		 * wording; this component adds no vocabulary for it.
		 */
		ageLabel?: string | null;
		/**
		 * Live variant only: whether the feed is behind its freshness budget. The
		 * updated variant ignores this (a daily document never reads "stale").
		 */
		isStale?: boolean;
		/**
		 * Live variant only: at least one active family is failing while retained
		 * data remains usable. Degraded freshness is caution, never green, but it
		 * does not fabricate a globally stale verdict.
		 */
		degraded?: boolean;
		/** "live" (current-data chip) or "updated" (calm neutral stamp). */
		variant?: Variant;
		/** UI language for the intrinsic labels. */
		locale: Locale;
		/** Optional extra classes on the stamp. */
		class?: string;
	}

	let {
		generatedUtc,
		ageSeconds = undefined,
		ageLabel = null,
		isStale = false,
		degraded = false,
		variant = 'live',
		locale,
		class: className,
	}: FreshnessStampProps = $props();

	// Keep the ONE shared clock alive while this stamp is on screen so its relative
	// age ticks in lockstep with every other time label in the chrome.
	$effect(() => sharedClock.subscribe());

	type Labels = {
		readonly live: string;
		readonly updated: string;
		readonly stale: string;
		readonly unknown: string;
	};
	const L: Record<Locale, Labels> = {
		fr: { live: 'EN DIRECT', updated: 'Mis à jour', stale: 'obsolète', unknown: 'inconnu' },
		en: { live: 'LIVE', updated: 'Updated', stale: 'stale', unknown: 'unknown' },
	};
	const t = $derived(L[locale]);

	// The effective age: a caller-supplied ticking age wins (live store); otherwise
	// the centralized server-anchored derivation off the shared clock. Both
	// re-derive every shared tick, so the readout never freezes.
	const effectiveAge = $derived<number | null>(
		ageSeconds !== undefined
			? ageSeconds
			: freshnessAgeSeconds(generatedUtc, sharedClock.serverNow),
	);

	// Doctrine §3.5 freshness display: a RELATIVE age under 24h ("4 minutes ago"),
	// switching to an ABSOLUTE America/Toronto timestamp at/above 24h ("Jun 21,
	// 14:32 EDT") — a day-plus-old reading is more useful as the real moment than a
	// vague "2 days ago". Honest "unknown" when there is no resolvable anchor.
	const ABSOLUTE_AFTER_S = 86_400; // 24h
	const relative = $derived.by(() => {
		if (ageLabel != null) return ageLabel;
		if (effectiveAge == null) return t.unknown;
		if (effectiveAge >= ABSOLUTE_AFTER_S && generatedUtc) {
			return formatUtc(generatedUtc, locale, {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				timeZoneName: 'short',
			});
		}
		return formatRelativeSeconds(effectiveAge, locale);
	});
</script>

{#if variant === 'live'}
	<span
		class={cn('freshness-stamp freshness-stamp--live', className)}
		data-slot="freshness-stamp"
		data-variant="live"
		data-stale={isStale}
		data-degraded={degraded ? 'true' : undefined}
		data-age-seconds={effectiveAge ?? undefined}
	>
		<StatusDot color={isStale || degraded ? 'caution' : 'on_time'} label={t.live} />
		<span class="freshness-stamp-label">{t.live}</span>
		<!-- Visible relative age (ticks every second) + the machine-readable build
		     timestamp on the <time> datetime for AT / scrapers. -->
		<time class="freshness-stamp-age" datetime={generatedUtc ?? undefined}>{relative}</time>
		{#if isStale}
			<span class="freshness-stamp-stale">· {t.stale}</span>
		{/if}
	</span>
{:else}
	<!-- Calm, minute-granular stamp → aria-live=polite announces each refresh. The
	     live variant deliberately omits it: it ticks per-second and the sr-only LIVE
	     label already conveys liveness, so per-second announcements would spam assistive tech. -->
	<span
		class={cn('freshness-stamp freshness-stamp--updated', className)}
		data-slot="freshness-stamp"
		data-variant="updated"
		data-age-seconds={effectiveAge ?? undefined}
		aria-live="polite"
	>
		<!-- Decorative neutral dot — the "Updated …" text already carries the meaning,
		     so the dot adds no sr-only label (no pulse: this is not a live feed). -->
		<StatusDot color="unknown" aria-hidden="true" />
		<span class="freshness-stamp-label">{t.updated}</span>
		<time class="freshness-stamp-age" datetime={generatedUtc ?? undefined}>{relative}</time>
	</span>
{/if}

<style>
	.freshness-stamp {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
	}
	/* Live variant: the LIVE label rides the accent voice (the chip's identity). */
	.freshness-stamp--live .freshness-stamp-label {
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--accent-text);
	}
	/* Updated variant: a calm muted overline — never the hot accent. */
	.freshness-stamp--updated .freshness-stamp-label {
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.freshness-stamp-age {
		color: var(--muted-foreground);
	}
	.freshness-stamp--updated .freshness-stamp-age {
		color: var(--foreground);
	}
	.freshness-stamp-stale {
		color: var(--dataviz-status-late);
	}
</style>
