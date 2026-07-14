import { encodeHistoryEntityId } from './entity';
import { strictIsoDate } from './selection';

export type RetainedRangeHistoryFamily = 'network' | 'lines' | 'stops';
export type RetainedPointHistoryFamily = 'hotspots' | 'repeat_offenders';
export type RetainedHistoryFamily = RetainedRangeHistoryFamily | RetainedPointHistoryFamily;

const RANGE_FAMILIES = new Set<RetainedRangeHistoryFamily>(['network', 'lines', 'stops']);
const POINT_FAMILIES = new Set<RetainedPointHistoryFamily>(['hotspots', 'repeat_offenders']);

const POINTER_SHA = '[0-9a-f]{64}';
const VERSIONED_POINTER = new RegExp(`/generations/(${POINTER_SHA})/index\\.json$`);

export function historyPointerPayloadSha(path: string): string | null {
	return VERSIONED_POINTER.exec(path)?.[1] ?? null;
}

export function isRetainedRangeHistoryFamily(value: unknown): value is RetainedRangeHistoryFamily {
	return typeof value === 'string' && RANGE_FAMILIES.has(value as RetainedRangeHistoryFamily);
}

export function isRetainedPointHistoryFamily(value: unknown): value is RetainedPointHistoryFamily {
	return typeof value === 'string' && POINT_FAMILIES.has(value as RetainedPointHistoryFamily);
}

export function isHistoryFamilyIndexPath(family: RetainedHistoryFamily, path: string): boolean {
	if (!isRetainedRangeHistoryFamily(family) && !isRetainedPointHistoryFamily(family)) return false;
	if (isRetainedRangeHistoryFamily(family) && path === `historic/history/${family}/index.json`) {
		return true;
	}
	return new RegExp(`^historic/history/${family}/generations/${POINTER_SHA}/index\\.json$`).test(
		path,
	);
}

export function historyPointArtifactPayloadSha(
	family: RetainedPointHistoryFamily,
	date: string,
	path: string,
): string | null {
	if (!isRetainedPointHistoryFamily(family) || !strictIsoDate(date)) return null;
	return (
		new RegExp(`^historic/history/${family}/generations/(${POINTER_SHA})/${date}\\.json$`).exec(
			path,
		)?.[1] ?? null
	);
}

export function isHistoryPointArtifactPath(
	family: RetainedPointHistoryFamily,
	date: string,
	path: string,
): boolean {
	return historyPointArtifactPayloadSha(family, date, path) !== null;
}

export function isHistoryEntityIndexPath(
	family: 'lines' | 'stops',
	entityId: string,
	path: string,
): boolean {
	let encodedId: string;
	try {
		encodedId = encodeHistoryEntityId(entityId);
	} catch {
		return false;
	}
	const prefix = `historic/history/${family}/${encodedId}`;
	if (path === `${prefix}/index.json`) return true;
	return new RegExp(`^${prefix}/generations/${POINTER_SHA}/index\\.json$`).test(path);
}
