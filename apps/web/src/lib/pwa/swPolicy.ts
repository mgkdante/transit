export const DATA_PATH_PREFIX = '/data/';

export const KILL_FLAG_PATH = '/sw-kill.json';

export interface KillFlag {
	disabled?: boolean;
}

export function isDataRequest(url: URL): boolean {
	const path = url.pathname;
	if (path === '/data' || path.startsWith(DATA_PATH_PREFIX)) return true;
	if (path.includes('/v1/') || path.endsWith('/v1')) return true;
	return false;
}

export function isKillFlagRequest(url: URL): boolean {
	return url.pathname === KILL_FLAG_PATH;
}

export function isShellAsset(url: URL, precachedAssets: ReadonlySet<string>): boolean {
	if (isDataRequest(url)) return false;
	if (isKillFlagRequest(url)) return false;
	const path = url.pathname;
	if (path.startsWith('/_app/immutable/')) return true;
	return precachedAssets.has(path);
}

export function isNavigationRequest(req: {
	mode?: string;
	headers?: { get(name: string): string | null };
}): boolean {
	if (req.mode === 'navigate') return true;
	const accept = req.headers?.get?.('accept') ?? '';
	return accept.includes('text/html');
}

export function shouldHandle(
	req: { method?: string; headers?: { get(name: string): string | null } },
	url: URL,
	origin: string,
): boolean {
	if ((req.method ?? 'GET').toUpperCase() !== 'GET') return false;
	if (url.origin !== origin) return false;
	// Range requests, including PMTiles, bypass the service worker.
	if (req.headers?.get?.('range')) return false;
	// Live data is never our concern.
	if (isDataRequest(url)) return false;
	// The kill flag is fetched directly by the SW, never via the fetch handler.
	if (isKillFlagRequest(url)) return false;
	return true;
}

export function shouldIntercept(
	req: {
		method?: string;
		mode?: string;
		headers?: { get(name: string): string | null };
	},
	url: URL,
	origin: string,
	precachedAssets: ReadonlySet<string>,
): boolean {
	if (!shouldHandle(req, url, origin)) return false;
	return isNavigationRequest(req) || isShellAsset(url, precachedAssets);
}

export function shouldKill(flag: KillFlag | null | undefined): boolean {
	return flag?.disabled === true;
}

export function cacheNameFor(version: string): string {
	return `transit-shell-${version}`;
}

export function precachePathnames(
	assetUrls: readonly string[],
	origin: string,
	offlinePath: string,
): Set<string> {
	const out = new Set<string>();
	for (const raw of assetUrls) {
		try {
			out.add(new URL(raw, origin).pathname);
		} catch {
			// Skip anything that will not resolve to a URL; never throw at install.
		}
	}
	out.add(offlinePath);
	return out;
}
