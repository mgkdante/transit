import { encodeHistoryEntityId } from './entity';

export type RetainedHistoryFamily = 'network' | 'lines' | 'stops';

const POINTER_SHA = '[0-9a-f]{64}';
const VERSIONED_POINTER = new RegExp(`/generations/(${POINTER_SHA})/index\\.json$`);

export function historyPointerPayloadSha(path: string): string | null {
	return VERSIONED_POINTER.exec(path)?.[1] ?? null;
}

export function isHistoryFamilyIndexPath(family: RetainedHistoryFamily, path: string): boolean {
	if (path === `historic/history/${family}/index.json`) return true;
	return new RegExp(`^historic/history/${family}/generations/${POINTER_SHA}/index\\.json$`).test(
		path,
	);
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
