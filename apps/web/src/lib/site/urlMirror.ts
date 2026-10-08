import { page } from '$app/state';
import { replaceState } from '$app/navigation';

export function currentMirrorUrl(stateUrl = page.url): URL {
	// Shallow navigation changes page.state while page.url can stay unchanged.
	void page.state;
	if (typeof window === 'undefined') return new URL(stateUrl);
	const browserUrl = new URL(window.location.href);
	return browserUrl.origin === stateUrl.origin && browserUrl.pathname === stateUrl.pathname
		? browserUrl
		: new URL(stateUrl);
}

export function mirrorSearchParam(key: string, value: string | null): void {
	mirrorSearchParams({ [key]: value });
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
		replaceState(url, { ...page.state });
	} catch {
		// The router may not be ready; the URL hint is best effort.
	}
}
