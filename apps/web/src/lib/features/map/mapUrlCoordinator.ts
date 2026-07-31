import { FILTER_SEARCH_PARAM_KEYS } from '$lib/filters';

export interface MapUrlRewriteOptions {
	readonly replaceState: true;
	readonly keepFocus: true;
	readonly noScroll: true;
}

export type MapUrlNavigate = (target: string, options: MapUrlRewriteOptions) => unknown;
export type MapUrlSettlement = 'echo' | 'adopt';

export const MAP_URL_REWRITE = {
	replaceState: true,
	keepFocus: true,
	noScroll: true,
} as const;

export interface MapUrlCoordinator {
	readonly currentUrl: () => URL;
	readonly goto: MapUrlNavigate;
	readonly writeFilters: (search: string) => void;
	readonly settle: (url: URL) => MapUrlSettlement;
}

function identity(url: URL): string {
	return `${url.pathname}${url.search}`;
}

function navigationTarget(url: URL): string {
	return identity(url);
}

export function createMapUrlCoordinator(
	initialUrl: URL,
	navigate: MapUrlNavigate,
): MapUrlCoordinator {
	let latestIntent = new URL(initialUrl.href);
	const requested: string[] = [];

	function request(target: string, options: MapUrlRewriteOptions): unknown {
		const next = new URL(target, latestIntent);
		const nextIdentity = identity(next);
		requested.push(nextIdentity);
		latestIntent = next;
		return navigate(navigationTarget(next), options);
	}

	function writeFilters(search: string): void {
		const next = new URL(latestIntent.href);
		for (const key of FILTER_SEARCH_PARAM_KEYS) next.searchParams.delete(key);
		const filters = new URLSearchParams(search);
		for (const key of FILTER_SEARCH_PARAM_KEYS) {
			for (const value of filters.getAll(key)) next.searchParams.append(key, value);
		}
		void request(navigationTarget(next), MAP_URL_REWRITE);
	}

	function settle(url: URL): MapUrlSettlement {
		const settled = new URL(url.href);
		const match = requested.indexOf(identity(settled));
		const cause: MapUrlSettlement = match === -1 ? 'adopt' : 'echo';
		if (match === -1) requested.length = 0;
		else requested.splice(0, match + 1);
		if (requested.length === 0) latestIntent = settled;
		return cause;
	}

	return {
		currentUrl: () => new URL(latestIntent.href),
		goto: request,
		writeFilters,
		settle,
	};
}
