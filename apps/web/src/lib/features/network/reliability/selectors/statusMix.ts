// statusMix — the live status-mix spec (the 5 StatusCodes by count).
//
// P5.2: emits a `stacked-share` ChartSpec for the ONE <Chart> renderer (the legacy
// StackedBar primitive is retired). The self-normalising 100% status bar stays EXEMPT
// from the absolute-magnitude domain law — each band's length IS its share of the
// whole; the shared `stackedShareSpec` helper carries the legacy semantics (null→0,
// zero bands dropped). Each band carries the map cross-filter URL as `href` (the
// legacy onSelect callback was always a navigation). Total 0 ⇒ an honest absence spec.

import type { StatusDist } from '$lib/v1/schemas/network';
import { STATUS_CODES, type StatusCode } from '$lib/v1/schemas/types';
import type { ChartSpec } from '$lib/components/dataviz/chart';
import { stackedShareSpec } from '$lib/components/dataviz/chart/share';
import type { Locale } from '$lib/i18n/config';

export interface StatusMixOptions {
	/** Accessible title for the strip (the legacy `label`). */
	readonly title: string;
	readonly locale: Locale;
	/** Band → the localized map cross-filter URL (omit ⇒ non-navigating bands). */
	readonly hrefFor?: (code: StatusCode) => string;
}

/** code → localized status band label (the SHARED $lib/v1/enumLabels vocabulary). */
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
