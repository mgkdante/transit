// bullet.ts — build a BulletSpec for a KPI tile (a single value on a fixed zero-based
// domain with an optional target tick). The "every KPI is a LayerChart mark" mandate
// (S7 P2.2): each headline number gets a scale-context bullet beneath it. Pure (data project).

import type { Locale } from '$lib/i18n';
import type { BulletSpec } from '$lib/components/dataviz/chart/ChartSpec';

export interface BulletOpts {
	readonly title: string;
	readonly xLabel: string;
	readonly unit: string;
	/** The fixed zero-based domain [0, hi] the value sits on. */
	readonly domain: readonly [number, number];
	readonly target?: number | null;
	readonly targetLabel?: string;
	readonly tone?: BulletSpec['tone'];
	readonly n?: number | null;
}

export function selectBullet(value: number | null, locale: Locale, opts: BulletOpts): BulletSpec {
	return {
		kind: 'bullet',
		title: opts.title,
		locale,
		xLabel: opts.xLabel,
		unit: opts.unit,
		domain: [opts.domain[0], opts.domain[1]],
		value,
		target: opts.target ?? null,
		targetLabel: opts.targetLabel,
		tone: opts.tone ?? 'neutral',
		n: opts.n ?? null,
		absentReason: 'no-observations',
	};
}

/**
 * On-time band tone vs the 80% SLA target — reuses the §0 verdict bands so the bullet
 * colour and the verdict word never disagree. (good ≥80 · warn 60–80 · bad <60.)
 */
export function otpTone(otpPct: number | null): BulletSpec['tone'] {
	if (otpPct == null) return 'neutral';
	return otpPct >= 80 ? 'good' : otpPct >= 60 ? 'warn' : 'bad';
}
