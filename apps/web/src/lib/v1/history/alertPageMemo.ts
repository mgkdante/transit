import type { AlertArchivePage } from '$lib/v1/schemas';

export const ALERT_ARCHIVE_PAGE_MEMO_LIMIT = 64;

export interface AlertArchivePageMemo {
	readonly size: number;
	get(path: string): AlertArchivePage | undefined;
	remember(path: string, page: AlertArchivePage): void;
	clear(): void;
}

export function createAlertArchivePageMemo(
	limit = ALERT_ARCHIVE_PAGE_MEMO_LIMIT,
): AlertArchivePageMemo {
	const capacity = Math.max(1, Math.trunc(limit));
	const entries = new Map<string, AlertArchivePage>();

	return {
		get size() {
			return entries.size;
		},
		get(path) {
			const page = entries.get(path);
			if (page === undefined) return undefined;
			entries.delete(path);
			entries.set(path, page);
			return page;
		},
		remember(path, page) {
			entries.delete(path);
			entries.set(path, page);
			while (entries.size > capacity) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) break;
				entries.delete(oldest);
			}
		},
		clear() {
			entries.clear();
		},
	};
}

export const alertArchivePageMemo = createAlertArchivePageMemo();
