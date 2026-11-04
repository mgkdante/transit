import type { StatusDist } from '#lib/v1/schemas/network.ts';
import { STATUS_CODES, type StatusCode } from '#lib/v1/schemas/types.ts';
import type { ChartSpec } from '#lib/components/dataviz/chart/index.ts';
import { stackedShareSpec } from '#lib/components/dataviz/chart/share.ts';
import type { Locale } from '#lib/i18n/config.ts';

export interface StatusMixOptions {
	readonly title: string;
	readonly locale: Locale;
	readonly hrefFor?: (code: StatusCode) => string;
}

export function selectStatusMix(
	dist: StatusDist | null | undefined,
	statusLabel: (code: StatusCode) => string,
	opts: StatusMixOptions,
): ChartSpec {
	const spec = stackedShareSpec({
		title: opts.title,
		locale: opts.locale,
		scale: 'status',
		legend: true,
		size: 'md',
		inputs: STATUS_CODES.map((code: StatusCode) => ({
			code,
			value: dist ? dist[code] : null,
			label: statusLabel(code),
			href: opts.hrefFor?.(code),
		})),
	});
	return (
		spec ?? {
			kind: 'absence',
			title: opts.title,
			locale: opts.locale,
			reason: 'no-observations',
			variant: 'inline',
		}
	);
}
