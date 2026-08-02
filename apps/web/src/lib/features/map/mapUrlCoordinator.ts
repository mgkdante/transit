// mapUrlCoordinator — the single latest-intent URL composer for the /map runtime
// (M4a A5). THE PROBLEM IT KILLS: any writer composing against the SETTLED
// $page.url can resurrect state another writer just cleared (the near-pin race —
// clear() starts a goto, a filter write reads the stale URL, near comes back).
// THE DESIGN: three writers (filter, near, focus) all compose against the last
// REQUESTED URL (`latestIntent`), never the settled one. Requested identities are
// FIFO CONSUME-ONCE tokens: a settle matching a token is an 'echo' for FILTER
// ownership and retires the matched prefix — a later genuine navigation onto
// the SAME URL finds no token and classifies 'adopt' (user-owned rehydration).
// That URL-only label deliberately says nothing about navigation focus: each
// rewrite also carries an owner+revision receipt so the actual winning commit,
// including byte-identical duplicates, can prove causal ownership. An unmatched
// settle clears the queue; whenever the queue is empty the base RESETS to the
// settled URL, so an externally aborted/superseded navigation can never leave
// the base stale. Identities are origin-free pathname+search with relative
// targets resolved at request time, so /fr/map composes against itself. Mirrors
// the S5-377 two-concept discipline the near controller's {syncUrl, urlBacked}
// seam established.
import { FILTER_SEARCH_PARAM_KEYS } from '$lib/filters';

export interface MapUrlRewriteOptions {
	readonly replaceState: true;
	readonly keepFocus: true;
	readonly noScroll: true;
	readonly state?: Readonly<Record<string, unknown>>;
}

export type MapUrlNavigate = (target: string, options: MapUrlRewriteOptions) => unknown;
export type MapUrlSettlement = 'echo' | 'adopt';

export interface MapUrlIntent {
	readonly url: URL;
	readonly ownerId: string;
	readonly revision: number;
}

export interface MapUrlRewriteReceipt {
	readonly ownerId: string;
	readonly revision: number;
}

const MAP_URL_REWRITE_RECEIPT_KEY = '__transitMapUrlRewrite';
let fallbackOwnerSequence = 0;

function createOwnerId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `map-url-${Date.now()}-${++fallbackOwnerSequence}`;
}

export function readMapUrlRewriteReceipt(state: unknown): MapUrlRewriteReceipt | null {
	if (state == null || typeof state !== 'object') return null;
	const receipt = (state as Record<string, unknown>)[MAP_URL_REWRITE_RECEIPT_KEY];
	if (receipt == null || typeof receipt !== 'object') return null;
	const { ownerId, revision } = receipt as Record<string, unknown>;
	return typeof ownerId === 'string' && Number.isSafeInteger(revision) && Number(revision) > 0
		? { ownerId, revision: Number(revision) }
		: null;
}

export const MAP_URL_REWRITE = {
	replaceState: true,
	keepFocus: true,
	noScroll: true,
} as const;

export interface MapUrlCoordinator {
	readonly currentUrl: () => URL;
	readonly currentIntent: () => MapUrlIntent;
	readonly goto: MapUrlNavigate;
	readonly writeFilters: (search: string) => void;
	readonly settle: (url: URL) => MapUrlSettlement;
	readonly pendingRequestCount: () => number;
	readonly dispose: () => void;
}

// One string serves as BOTH the token-matching key and the navigation target:
// origin-free, locale-prefix preserved.
function identity(url: URL): string {
	return `${url.pathname}${url.search}`;
}

export function createMapUrlCoordinator(
	initialUrl: URL,
	navigate: MapUrlNavigate,
	readPageState: () => Readonly<Record<string, unknown>> = () => ({}),
): MapUrlCoordinator {
	let latestIntent = new URL(initialUrl.href);
	let intentRevision = 0;
	const ownerId = createOwnerId();
	const requested: string[] = [];

	function request(target: string, options: MapUrlRewriteOptions): unknown {
		const next = new URL(target, latestIntent);
		const nextIdentity = identity(next);
		requested.push(nextIdentity);
		latestIntent = next;
		intentRevision += 1;
		return navigate(nextIdentity, {
			...options,
			state: {
				...readPageState(),
				...options.state,
				[MAP_URL_REWRITE_RECEIPT_KEY]: { ownerId, revision: intentRevision },
			},
		});
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
		const match = requested.indexOf(identity(settled));
		const cause: MapUrlSettlement = match === -1 ? 'adopt' : 'echo';
		if (match === -1) requested.length = 0;
		else requested.splice(0, match + 1);
		if (requested.length === 0) latestIntent = settled;
		return cause;
	}

	return {
		currentUrl: () => new URL(latestIntent.href),
		currentIntent: () => ({
			url: new URL(latestIntent.href),
			ownerId,
			revision: intentRevision,
		}),
		goto: request,
		writeFilters,
		settle,
		pendingRequestCount: () => requested.length,
		dispose() {
			requested.length = 0;
		},
	};
}
