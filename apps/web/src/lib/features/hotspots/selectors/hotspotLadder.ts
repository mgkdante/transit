import type { Locale } from '$lib/i18n';
import type {
	AbsenceSpec,
	ChartDatumPopoverModel,
	MagnitudeBarsSpec,
	MagnitudeDatum,
} from '$lib/components/dataviz/chart';
import { SEVERE_DOMAIN } from '$lib/features/reliability/domains';
import { severeShareToSeverity } from '$lib/features/reliability/shiftGrains';
import type { HotspotEntry } from '$lib/v1/schemas';

export interface HotspotPopoverEvidence {
	readonly wilsonLo: number | null;
	readonly wilsonHi: number | null;
}

export interface HotspotLadderLabels {
	title: string;
	rowLabel: string;
	xLabel: string;
	unit: string;
	ciLabel: string;
	note: (e: HotspotEntry) => string;
	unnamed: (id: string) => string;
	href: (e: HotspotEntry) => string | null;
	tapPopover: (
		entry: HotspotEntry,
		href: string | null,
		evidence: HotspotPopoverEvidence,
	) => ChartDatumPopoverModel;
}

export interface HotspotLadderResult {
	spec: MagnitudeBarsSpec | AbsenceSpec;
	total: number;
	shown: number;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

const severeCiLo = (e: HotspotEntry): number | null =>
	e.wilson_lo != null && e.wilson_hi != null ? round1(100 - e.wilson_hi) : null;
const severeCiHi = (e: HotspotEntry): number | null =>
	e.wilson_lo != null && e.wilson_hi != null ? round1(100 - e.wilson_lo) : null;

export function selectHotspotLadder(
	entries: readonly HotspotEntry[],
	cap: number,
	locale: Locale,
	labels: HotspotLadderLabels,
): HotspotLadderResult {
	const total = entries.length;
	const top = entries.slice(0, Math.max(0, cap));
	const shown = top.length;

	if (shown === 0) {
		return {
			spec: {
				kind: 'absence',
				title: labels.title,
				locale,
				reason: 'no-observations',
				variant: 'block',
			},
			total,
			shown,
		};
	}

	const rows: MagnitudeDatum[] = top.map((e) => {
		const href = labels.href(e);
		const wilsonLo = severeCiLo(e);
		const wilsonHi = severeCiHi(e);
		return {
			key: `${e.type}-${e.id}`,
			label: e.name ?? labels.unnamed(e.id),
			value: e.severe_pct ?? null,
			severity: severeShareToSeverity(e.severe_pct ?? null),
			n: e.observation_count ?? null,
			wilsonLo,
			wilsonHi,
			note: labels.note(e),
			tapPopover: labels.tapPopover(e, href, { wilsonLo, wilsonHi }),
			...(href ? { href } : {}),
		};
	});

	return {
		spec: {
			kind: 'magnitude-bars',
			mark: 'lollipop',
			title: labels.title,
			locale,
			domain: SEVERE_DOMAIN,
			unit: labels.unit,
			rowLabel: labels.rowLabel,
			xLabel: labels.xLabel,
			ciLabel: labels.ciLabel,
			rows,
			sort: 'given',
			scale: 'severity',
		},
		total,
		shown,
	};
}
