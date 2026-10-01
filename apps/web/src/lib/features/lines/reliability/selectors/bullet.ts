import type { Locale } from '$lib/i18n';
import type { BulletSpec } from '$lib/components/dataviz/chart/ChartSpec';

export interface BulletOpts {
	readonly title: string;
	readonly xLabel: string;
	readonly unit: string;
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

export function otpTone(otpPct: number | null): BulletSpec['tone'] {
	if (otpPct == null) return 'neutral';
	return otpPct >= 80 ? 'good' : otpPct >= 60 ? 'warn' : 'bad';
}
