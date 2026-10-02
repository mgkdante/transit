export const ROUTE_TYPE_METRO = 1;

export const METRO_REALTIME_GAP = 'metro_realtime';

export type ServiceWindowState = 'open' | 'before-open' | 'overnight' | 'closed' | 'unknown';

export function parseWallClockMinutes(value: string | null | undefined): number | null {
	if (value == null) return null;
	const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (!m) return null;
	const hour = Number.parseInt(m[1], 10);
	const minute = Number.parseInt(m[2], 10);
	if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
	return hour * 60 + minute;
}

export function serviceWindowState(
	first: string | null | undefined,
	last: string | null | undefined,
	now: number,
): ServiceWindowState {
	const firstMin = parseWallClockMinutes(first);
	const lastMin = parseWallClockMinutes(last);
	if (firstMin == null || lastMin == null || Number.isNaN(now)) return 'unknown';

	if (lastMin >= firstMin) {
		if (now < firstMin) return 'before-open';
		if (now > lastMin) return 'closed';
		return 'open';
	}

	if (now >= firstMin || now <= lastMin) return 'open';
	return 'overnight';
}

export function stopServiceWindow(
	times: readonly string[] | null | undefined,
): { first: string; last: string } | null {
	if (!times || times.length === 0) return null;
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const raw of times) {
		const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
		if (!m) continue;
		const hour = Number.parseInt(m[1], 10);
		const minute = Number.parseInt(m[2], 10);
		if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59) continue;
		const abs = hour * 60 + minute;
		if (abs < min) min = abs;
		if (abs > max) max = abs;
	}
	if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
	const toHm = (abs: number): string => {
		const wall = ((abs % 1440) + 1440) % 1440;
		const h = Math.floor(wall / 60);
		const mm = wall % 60;
		return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
	};
	return { first: toHm(min), last: toHm(max) };
}

export type AbsenceReasonKey =
	| 'metro-no-realtime'
	| 'closed-opens-at'
	| 'overnight-opens-at'
	| 'before-open'
	| 'scheduled-silent'
	| 'last-seen';

export interface AbsenceReason {
	readonly key: AbsenceReasonKey;
	readonly firstDeparture?: string;
	readonly lastSeenIso?: string;
}

export interface AbsenceSignals {
	readonly routeType?: number | null;
	readonly gaps?: readonly string[] | null;
	readonly firstDeparture?: string | null;
	readonly lastDeparture?: string | null;
	readonly nowMinutes?: number | null;
	readonly nonResponding?: boolean;
	readonly lastSeenIso?: string | null;
}

export function inferAbsenceReason(signals: AbsenceSignals): AbsenceReason | null {
	const { routeType, gaps, firstDeparture, lastDeparture, nowMinutes, nonResponding, lastSeenIso } =
		signals;

	const hasMetroGap = (gaps ?? []).includes(METRO_REALTIME_GAP);
	if (routeType === ROUTE_TYPE_METRO && hasMetroGap) {
		return { key: 'metro-no-realtime' };
	}

	if (lastSeenIso != null && lastSeenIso !== '') {
		return { key: 'last-seen', lastSeenIso };
	}

	if (nowMinutes != null && !Number.isNaN(nowMinutes)) {
		const state = serviceWindowState(firstDeparture, lastDeparture, nowMinutes);
		const first = firstDeparture ?? undefined;
		if (state === 'closed' && first) return { key: 'closed-opens-at', firstDeparture: first };
		if (state === 'overnight' && first) return { key: 'overnight-opens-at', firstDeparture: first };
		if (state === 'before-open' && first) return { key: 'before-open', firstDeparture: first };
		if (state === 'open' && nonResponding === true) return { key: 'scheduled-silent' };
	}

	return null;
}
