// mapUrlCoordinator — the single latest-intent URL composer for the /map runtime
// (M4a A5). THE PROBLEM IT KILLS: any writer composing against the SETTLED
// $page.url can resurrect state another writer just cleared (the near-pin race —
// clear() starts a goto, a filter write reads the stale URL, near comes back).
// THE DESIGN: three writers (filter, near, focus) all compose against the last
// REQUESTED URL (`latestIntent`), never the settled one. Requested identities are
// FIFO CONSUME-ONCE tokens: a settle matching a token is an 'echo' for FILTER
// ownership and retires the matched prefix — a later genuine navigation onto
// the SAME URL finds no token and classifies 'adopt' (user-owned rehydration).
// An unmatched settle clears the queue; whenever the queue is empty the base
// RESETS to the settled URL, so an externally aborted/superseded navigation can
// never leave the base stale. Identities are origin-free pathname+search with
// relative targets resolved at request time, so /fr/map composes against itself.
import { FILTER_SEARCH_PARAM_KEYS } from '$lib/filters';

export interface MapUrlRewriteOptions {
	readonly replaceState: true;
	readonly keepFocus: true;
	readonly noScroll: true;
}

export type MapUrlNavigate = (target: string, options: MapUrlRewriteOptions) => unknown;
export type MapUrlSettlement = 'echo' | 'adopt';

export interface MapUrlCoordinatorOptions {
	readonly reportNavigationFailure?: (error: unknown) => unknown;
}

export const MAP_URL_REWRITE = {
	replaceState: true,
	keepFocus: true,
	noScroll: true,
} as const;

export interface MapUrlCoordinator {
	readonly currentUrl: () => URL;
	readonly dispose: () => void;
	readonly goto: MapUrlNavigate;
	readonly writeFilters: (search: string) => void;
	readonly settle: (url: URL) => MapUrlSettlement;
}

// FIFO token matching stays origin-free pathname+search.
function identity(url: URL): string {
	return `${url.pathname}${url.search}`;
}

export function createMapUrlCoordinator(
	initialUrl: URL,
	navigate: MapUrlNavigate,
	options: MapUrlCoordinatorOptions = {},
): MapUrlCoordinator {
	interface RequestedNavigation {
		readonly identity: string;
		readonly url: URL;
	}

	let settledBase = new URL(initialUrl.href);
	let latestIntent = new URL(initialUrl.href);
	let disposed = false;
	const requested: RequestedNavigation[] = [];

	function reportFailure(error: unknown): void {
		try {
			const reported = options.reportNavigationFailure
				? options.reportNavigationFailure(error)
				: console.error('Map URL navigation failed', error);
			if (reported && typeof (reported as PromiseLike<unknown>).then === 'function') {
				void Promise.resolve(reported).catch((reporterError) => {
					try {
						console.error('Map URL navigation failure reporter failed', reporterError);
					} catch {
						// Reporting must never create another unhandled navigation failure.
					}
				});
			}
		} catch (reporterError) {
			try {
				console.error('Map URL navigation failure reporter failed', reporterError);
			} catch {
				// Reporting must never reopen the navigation failure path.
			}
		}
	}

	function retireFailedRequest(token: RequestedNavigation, error: unknown): void {
		if (!disposed) {
			const index = requested.indexOf(token);
			if (index !== -1) requested.splice(index, 1);
			latestIntent = new URL(requested.at(-1)?.url.href ?? settledBase.href);
		}
		reportFailure(error);
	}

	function request(target: string, options: MapUrlRewriteOptions): unknown {
		if (disposed) return undefined;
		const next = new URL(target, latestIntent);
		const token = { identity: identity(next), url: new URL(next.href) };
		requested.push(token);
		latestIntent = next;
		let navigation: unknown;
		try {
			navigation = navigate(token.identity, options);
		} catch (error) {
			retireFailedRequest(token, error);
			throw error;
		}
		if (navigation && typeof (navigation as PromiseLike<unknown>).then === 'function') {
			void Promise.resolve(navigation).catch((error) => retireFailedRequest(token, error));
		}
		return navigation;
	}

	function writeFilters(search: string): void {
		const next = new URL(latestIntent.href);
		for (const key of FILTER_SEARCH_PARAM_KEYS) next.searchParams.delete(key);
		const filters = new URLSearchParams(search);
		for (const key of FILTER_SEARCH_PARAM_KEYS) {
			for (const value of filters.getAll(key)) next.searchParams.append(key, value);
		}
		void request(identity(next), MAP_URL_REWRITE);
	}

	function settle(url: URL): MapUrlSettlement {
		const settled = new URL(url.href);
		settledBase = settled;
		const match = requested.findIndex((token) => token.identity === identity(settled));
		const cause: MapUrlSettlement = match === -1 ? 'adopt' : 'echo';
		if (match === -1) requested.length = 0;
		else requested.splice(0, match + 1);
		if (requested.length === 0) latestIntent = settled;
		return cause;
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		requested.length = 0;
		latestIntent = new URL(settledBase.href);
	}

	return {
		currentUrl: () => new URL(latestIntent.href),
		dispose,
		goto: request,
		writeFilters,
		settle,
	};
}
