import { page } from '$app/state';
import { replaceState } from '$app/navigation';

function currentMirrorUrl(): URL {
	const browserUrl = new URL(window.location.href);
	const stateUrl = page.url;
	return browserUrl.origin === stateUrl.origin && browserUrl.pathname === stateUrl.pathname
		? browserUrl
		: new URL(stateUrl);
}

export function mirrorSearchParam(key: string, value: string | null): void {
	if (typeof window === 'undefined') return;
	const url = currentMirrorUrl();
	if (url.searchParams.get(key) === value) return;
	if (value === null) url.searchParams.delete(key);
	else url.searchParams.set(key, value);
	try {
		replaceState(url, page.state);
	} catch {
		// The router may not be ready; the URL hint is best effort.
	}
}

export function mirrorSearchParams(params: Record<string, string | null>): void {
	if (typeof window === 'undefined') return;
	const url = currentMirrorUrl();
	let changed = false;
	for (const [key, value] of Object.entries(params)) {
		const current = url.searchParams.get(key);
		if (value === null) {
			if (current !== null) {
				url.searchParams.delete(key);
				changed = true;
			}
		} else if (current !== value) {
			url.searchParams.set(key, value);
			changed = true;
		}
	}
	if (!changed) return;
	try {
		replaceState(url, page.state);
	} catch {
		// The router may not be ready; the URL hint is best effort.
	}
}
