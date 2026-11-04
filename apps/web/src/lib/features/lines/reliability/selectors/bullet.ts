import type { Locale } from '#lib/i18n/index.ts';
import type { BulletSpec } from '#lib/components/dataviz/chart/ChartSpec.ts';
import type { VerdictStatus } from '#lib/v1/verdict.ts';

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

export function verdictTone(status: VerdictStatus | null | undefined): BulletSpec['tone'] {
	return status === 'reliable'
		? 'good'
		: status === 'patchy'
			? 'warn'
			: status === 'unreliable'
				? 'bad'
				: 'neutral';
}
