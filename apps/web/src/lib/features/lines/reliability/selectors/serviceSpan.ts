import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, ServiceSpanSpec, ServiceSpanTick } from '$lib/components/dataviz/chart';
import { elapsedUtcMinutes, formatUtc } from '$lib/utils/time';

const DAY_MIN = 1440;
const SIX_HOURS_MIN = 360;
const ENDPOINT_FORMAT = {
	year: 'numeric',
	month: 'short',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hourCycle: 'h23',
	timeZoneName: 'shortOffset',
} as const;

export interface ServiceSpanInput {
	readonly firstTripUtc: string | null;
	readonly lastTripUtc: string | null;
	readonly firstDelayMin: number | null;
	readonly lastDelayMin: number | null;
}

export interface ServiceSpanOpts {
	readonly firstLabel: string;
	readonly lastLabel: string;
	readonly firstDelayLabel: string;
	readonly lastDelayLabel: string;
	readonly spanLabel: string | null;
	readonly tripsLabel: string | null;
	readonly hourLabel: (hour: number) => string;
	readonly ariaLabel: (first: string, last: string) => string;
	readonly absentTitle: string;
	readonly noDataLabel: string;
}

export function selectServiceSpan(
	input: ServiceSpanInput,
	locale: Locale,
	opts: ServiceSpanOpts,
): ServiceSpanSpec | AbsenceSpec {
	const elapsedMin = elapsedUtcMinutes(input.firstTripUtc, input.lastTripUtc);
	if (elapsedMin == null) {
		return {
			kind: 'absence',
			title: opts.absentTitle,
			locale,
			reason: 'no-observations',
			variant: 'block',
		};
	}

	const firstClock = formatUtc(input.firstTripUtc!, locale, ENDPOINT_FORMAT);
	const lastClock = formatUtc(input.lastTripUtc!, locale, ENDPOINT_FORMAT);
	const domainEnd = Math.max(DAY_MIN, Math.ceil(elapsedMin / SIX_HOURS_MIN) * SIX_HOURS_MIN);
	const tickStep = Math.ceil(domainEnd / (4 * SIX_HOURS_MIN)) * SIX_HOURS_MIN;
	const tickMins = Array.from({ length: Math.ceil(domainEnd / tickStep) }, (_, i) => i * tickStep);
	tickMins.push(domainEnd);
	const hourTicks: ServiceSpanTick[] = tickMins.map((min) => ({
		min,
		label: opts.hourLabel(min / 60),
	}));

	return {
		kind: 'service-span',
		title: opts.ariaLabel(firstClock, lastClock),
		locale,
		domain: [0, domainEnd],
		elapsedMin,
		firstClock,
		lastClock,
		firstDelayMin: input.firstDelayMin,
		lastDelayMin: input.lastDelayMin,
		spanLabel: opts.spanLabel,
		tripsLabel: opts.tripsLabel,
		firstLabel: opts.firstLabel,
		lastLabel: opts.lastLabel,
		firstDelayLabel: opts.firstDelayLabel,
		lastDelayLabel: opts.lastDelayLabel,
		noDataLabel: opts.noDataLabel,
		hourTicks,
	};
}
