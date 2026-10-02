import type { Locale } from '$lib/i18n/config';
import type { OccupancyCode, StatusCode } from '$lib/v1/schemas';
import type { ShareSegment, StackedShareSpec } from './ChartSpec';

export interface ShareInput {
	readonly code: StatusCode | OccupancyCode;
	readonly value: number | null;
	readonly label: string;
	readonly href?: string;
}

const clean = (v: number | null): number => (v != null && Number.isFinite(v) ? Math.max(0, v) : 0);

export function shareSegments(
	scale: 'status' | 'occupancy',
	inputs: readonly ShareInput[],
): ShareSegment[] {
	const total = inputs.reduce((sum, i) => sum + clean(i.value), 0);
	if (total <= 0) return [];
	const out: ShareSegment[] = [];
	for (const i of inputs) {
		const v = clean(i.value);
		if (v <= 0) continue;
		out.push({
			key: i.code,
			label: i.label,
			share: (v / total) * 100,
			href: i.href,
			...(scale === 'status'
				? { status: i.code as StatusCode }
				: { occupancy: i.code as OccupancyCode }),
		});
	}
	return out;
}

export interface StackedShareSpecOptions {
	readonly title: string;
	readonly caption?: string;
	readonly locale: Locale;
	readonly scale: 'status' | 'occupancy';
	readonly inputs: readonly ShareInput[];
	readonly legend?: boolean;
	readonly size?: 'sm' | 'md';
}

export function stackedShareSpec(opts: StackedShareSpecOptions): StackedShareSpec | null {
	const segments = shareSegments(opts.scale, opts.inputs);
	if (segments.length === 0) return null;
	return {
		kind: 'stacked-share',
		title: opts.title,
		caption: opts.caption,
		locale: opts.locale,
		scale: opts.scale,
		segments,
		legend: opts.legend,
		size: opts.size,
	};
}
