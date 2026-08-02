import { delocalizePath } from '$lib/i18n';
import {
	MAP_URL_REWRITE,
	readMapUrlRewriteReceipt,
	type MapUrlIntent,
	type MapUrlNavigate,
	type MapUrlSettlement,
} from './mapUrlCoordinator';

interface MapDetailNavigationLifecycleOptions {
	readonly currentIntent: () => MapUrlIntent;
	readonly goto: MapUrlNavigate;
}

export interface MapDetailNavigationLifecycle {
	recordAccepted(target: URL | null): void;
	settle(
		url: URL,
		settleUrl: (url: URL) => MapUrlSettlement,
		navigationState: unknown,
	): MapUrlSettlement | 'recovered';
	dispose(): void;
}

type AcceptedTarget = {
	readonly sequence: number;
	readonly url: URL;
};

type PendingMapExit = {
	readonly exitSequence: number;
	readonly restoreUrl: URL;
	readonly rewriteOwnerId: string;
	readonly rewriteRevision: number;
	readonly focusTarget: HTMLElement | null;
};

function isMapUrl(url: URL): boolean {
	return delocalizePath(url.pathname) === '/map';
}

function samePageUrl(left: URL, right: URL): boolean {
	return (
		left.pathname === right.pathname && left.search === right.search && left.hash === right.hash
	);
}

/**
 * Records accepted targets synchronously, then lets only the exact committed
 * winner consume a pending map-exit obligation. Store subscribers see every
 * accepted publication even when Svelte effects coalesce adjacent navigations.
 */
export function createMapDetailNavigationLifecycle(
	options: MapDetailNavigationLifecycleOptions,
): MapDetailNavigationLifecycle {
	let acceptedSequence = 0;
	let latestAccepted: AcceptedTarget | null = null;
	let pendingMapExit: PendingMapExit | null = null;

	function captureMapExit(exitSequence: number): PendingMapExit | null {
		if (typeof document === 'undefined') return null;
		const detailSurface = document.querySelector<HTMLElement>(
			'[data-slot="map-detail-overlay"], [data-m6c2-detail-sheet]',
		);
		if (!detailSurface) return null;
		const intent = options.currentIntent();
		const activeElement = document.activeElement;
		return {
			exitSequence,
			restoreUrl: new URL(intent.url.href),
			rewriteOwnerId: intent.ownerId,
			rewriteRevision: intent.revision,
			focusTarget:
				activeElement instanceof HTMLElement && detailSurface.contains(activeElement)
					? activeElement
					: null,
		};
	}

	return {
		recordAccepted(target) {
			if (target == null) return;
			acceptedSequence += 1;
			latestAccepted = {
				sequence: acceptedSequence,
				url: new URL(target.href),
			};
			if (!isMapUrl(target)) pendingMapExit = captureMapExit(acceptedSequence);
		},
		settle(url, settleUrl, navigationState) {
			const settlement = settleUrl(url);
			if (!isMapUrl(url)) {
				pendingMapExit = null;
				return settlement;
			}
			if (pendingMapExit == null || latestAccepted == null) return settlement;
			const recovery = pendingMapExit;
			const isFinalMapWinner =
				latestAccepted.sequence > recovery.exitSequence &&
				isMapUrl(latestAccepted.url) &&
				samePageUrl(latestAccepted.url, url);
			if (!isFinalMapWinner) return settlement;

			pendingMapExit = null;
			const focusTarget = recovery.focusTarget;
			const focusStillOwned =
				focusTarget?.isConnected === true && document.activeElement === focusTarget;
			const winningReceipt = readMapUrlRewriteReceipt(navigationState);
			const protectedByNewerMapRewrite =
				winningReceipt?.ownerId === recovery.rewriteOwnerId &&
				winningReceipt.revision > recovery.rewriteRevision;
			if (!focusStillOwned || protectedByNewerMapRewrite) return settlement;

			focusTarget.focus({ preventScroll: true });
			void options.goto(
				`${recovery.restoreUrl.pathname}${recovery.restoreUrl.search}${recovery.restoreUrl.hash}`,
				MAP_URL_REWRITE,
			);
			return 'recovered';
		},
		dispose() {
			latestAccepted = null;
			pendingMapExit = null;
		},
	};
}
