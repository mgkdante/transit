import type { Locale } from '$lib/i18n';
import type {
	AbsenceSpec,
	ChartDatumPopoverModel,
	MagnitudeBarsSpec,
	MagnitudeDatum,
} from '$lib/components/dataviz/chart';
import { SEVERE_DOMAIN } from '$lib/features/reliability/domains';
import { severeShareToSeverity } from '$lib/features/reliability/shiftGrains';

export interface SevereLadderEvidence {
	readonly wilsonLo: number | null;
	readonly wilsonHi: number | null;
}

export interface SevereLadderLabels<T> {
	title: string;
	rowLabel: string;
	xLabel: string;
	unit: string;
	ciLabel: string;
	note: (entry: T) => string;
	href: (entry: T) => string | null;
	tapPopover?: (
		entry: T,
		href: string | null,
		evidence: SevereLadderEvidence,
	) => ChartDatumPopoverModel;
}

export interface SevereLadderResult {
	spec: MagnitudeBarsSpec | AbsenceSpec;
	total: number;
	shown: number;
}

interface SevereEntry {
	severe_pct?: number | null;
	observation_count?: number | null;
	wilson_lo?: number | null;
	wilson_hi?: number | null;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

export function encodeSevereLadder<T extends SevereEntry>(
	entries: readonly T[],
	cap: number,
	locale: Locale,
	labels: SevereLadderLabels<T>,
	identity: { key: (entry: T) => string; label: (entry: T) => string },
): SevereLadderResult {
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

	const rows: MagnitudeDatum[] = top.map((entry) => {
		const href = labels.href(entry);
		const wilsonLo =
			entry.wilson_lo != null && entry.wilson_hi != null ? round1(100 - entry.wilson_hi) : null;
		const wilsonHi =
			entry.wilson_lo != null && entry.wilson_hi != null ? round1(100 - entry.wilson_lo) : null;
		return {
			key: identity.key(entry),
			label: identity.label(entry),
			value: entry.severe_pct ?? null,
			severity: severeShareToSeverity(entry.severe_pct ?? null),
			n: entry.observation_count ?? null,
			wilsonLo,
			wilsonHi,
			note: labels.note(entry),
			...(labels.tapPopover
				? { tapPopover: labels.tapPopover(entry, href, { wilsonLo, wilsonHi }) }
				: {}),
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
