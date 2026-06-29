// selectServiceSpan — build a ServiceSpanSpec for the §2 first→last departure timeline
// (P3, S7 P5). Resolves the ISO-UTC endpoints to America/Toronto wall-clock minutes on a
// FIXED 24h domain [0,1440] (deterministic: new Date(iso) is pure). Honest absence: unless
// BOTH endpoints resolve to a real clock time, the whole mark is absent (says WHY), never a
// fabricated 0/"·". The signed first/last-trip delays + the span-length / trip-count
// annotations ride the spec; the mark renders them beside the timeline. Pure (data project).

import type { Locale } from '$lib/i18n';
import type { AbsenceSpec, ServiceSpanSpec, ServiceSpanTick } from '$lib/components/dataviz/chart';
import { formatClock, minutesSinceMidnight } from '$lib/utils/time';

const DAY_MIN = 1440;
const TICK_MINS = [0, 360, 720, 1080, 1440] as const;

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
	/** Pre-formatted span-length annotation (e.g. "18h 30m"); null ⇒ omitted. */
	readonly spanLabel: string | null;
	/** Pre-formatted trip-count annotation (e.g. "142 trips"); null ⇒ omitted. */
	readonly tripsLabel: string | null;
	/** Format an axis hour (0/6/12/18/24) into its tick label (e.g. "00h"). */
	readonly hourLabel: (hour: number) => string;
	/** Whole-figure accessible summary given the two clock times. */
	readonly ariaLabel: (first: string, last: string) => string;
	/** Fallback accessible name for the absent state. */
	readonly absentTitle: string;
	/** Localized "no data" text for an absent delay reading (a11y). */
	readonly noDataLabel: string;
}

function clockMinutes(iso: string | null): number | null {
	if (!iso) return null;
	const m = minutesSinceMidnight(new Date(iso));
	return Number.isNaN(m) ? null : m;
}
function clockText(iso: string | null, locale: Locale): string {
	return iso ? formatClock(new Date(iso), locale) : '·';
}

export function selectServiceSpan(
	input: ServiceSpanInput,
	locale: Locale,
	opts: ServiceSpanOpts,
): ServiceSpanSpec | AbsenceSpec {
	const firstMin = clockMinutes(input.firstTripUtc);
	const lastMin = clockMinutes(input.lastTripUtc);

	// The span is honest only when BOTH endpoints resolve to a real clock time.
	if (firstMin == null || lastMin == null) {
		return {
			kind: 'absence',
			title: opts.absentTitle,
			locale,
			reason: 'no-observations',
			variant: 'block',
		};
	}

	const firstClock = clockText(input.firstTripUtc, locale);
	const lastClock = clockText(input.lastTripUtc, locale);

	// FIX-2: a GTFS service day can run past local midnight (e.g. first 05:00 → last 01:30),
	// so the last trip's clock minute can fall BELOW the first's. Render it on a transit
	// SERVICE-DAY CLOCK (24h, 25h, …, 30h) by unwrapping the wrapped last endpoint forward one
	// day, instead of letting the bar invert on a fixed [0,1440] axis. The wall-clock TEXT
	// (firstClock/lastClock) still shows the real "05:00"/"01:30".
	const crossesMidnight = lastMin < firstMin;
	const lastMinResolved = crossesMidnight ? lastMin + DAY_MIN : lastMin;
	const domainEnd = crossesMidnight ? Math.ceil(lastMinResolved / 360) * 360 : DAY_MIN;
	const tickMins =
		domainEnd === DAY_MIN
			? TICK_MINS
			: Array.from({ length: domainEnd / 360 + 1 }, (_, i) => i * 360);
	const hourTicks: ServiceSpanTick[] = tickMins.map((min) => ({
		min,
		label: opts.hourLabel(min / 60),
	}));

	return {
		kind: 'service-span',
		title: opts.ariaLabel(firstClock, lastClock),
		locale,
		domain: [0, domainEnd],
		firstMin,
		lastMin: lastMinResolved,
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
