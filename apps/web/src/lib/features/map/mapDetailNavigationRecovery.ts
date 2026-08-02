import { beforeNavigate } from '$app/navigation';
import { delocalizePath } from '$lib/i18n';
import {
	MAP_URL_REWRITE,
	readMapUrlRewriteReceipt,
	type MapUrlIntent,
	type MapUrlNavigate,
	type MapUrlSettlement,
} from './mapUrlCoordinator';

interface MapDetailNavigationRecoveryOptions {
	readonly currentIntent: () => MapUrlIntent;
	readonly goto: MapUrlNavigate;
}

export interface MapDetailNavigationRecovery {
	observe(navigationTarget: URL | null): void;
	settle(
		url: URL,
		settleUrl: (url: URL) => MapUrlSettlement,
		navigationTarget: URL | null,
		navigationState: unknown,
	): MapUrlSettlement | 'recovered';
}

type PendingMapExit = {
	readonly restoreUrl: URL;
	readonly rewriteOwnerId: string;
	readonly rewriteRevision: number;
	readonly focusTarget: HTMLElement | null;
};

/**
 * A map exit owns no teardown until it commits. If its live winning navigation
 * settles back onto the still-mounted map, preserve the captured detail focus
 * unless a newer map-owned rewrite already carries `keepFocus` for that winner.
 */
export function attachMapDetailNavigationRecovery(
	options: MapDetailNavigationRecoveryOptions,
): MapDetailNavigationRecovery {
	let pendingMapExit: PendingMapExit | null = null;
	const captureCurrentIntent = (): PendingMapExit | null => {
		if (typeof document === 'undefined') return null;
		const detailSurface = document.querySelector<HTMLElement>(
			'[data-slot="map-detail-overlay"], [data-m6c2-detail-sheet]',
		);
		if (!detailSurface) return null;
		const intent = options.currentIntent();
		const activeElement = document.activeElement;
		return {
			restoreUrl: intent.url,
			rewriteOwnerId: intent.ownerId,
			rewriteRevision: intent.revision,
			focusTarget:
				activeElement instanceof HTMLElement && detailSurface.contains(activeElement)
					? activeElement
					: null,
		};
	};

	beforeNavigate((navigation) => {
		// A cancelled attempt leaves no completion callback. The next ordinary
		// before-navigation event retires that stale marker before classifying itself.
		pendingMapExit = null;
		if (
			navigation.from == null ||
			delocalizePath(navigation.from.url.pathname) !== '/map' ||
			navigation.to == null ||
			delocalizePath(navigation.to.url.pathname) === '/map' ||
			typeof document === 'undefined'
		) {
			return;
		}

		pendingMapExit = captureCurrentIntent();
	});

	return {
		observe(navigationTarget) {
			if (
				pendingMapExit != null ||
				navigationTarget == null ||
				delocalizePath(navigationTarget.pathname) === '/map'
			) {
				return;
			}
			pendingMapExit = captureCurrentIntent();
		},
		settle(url, settleUrl, navigationTarget, navigationState) {
			const settlement = settleUrl(url);
			if (pendingMapExit == null || delocalizePath(url.pathname) !== '/map') return settlement;
			const isLiveMapWinner =
				navigationTarget != null &&
				delocalizePath(navigationTarget.pathname) === '/map' &&
				navigationTarget.pathname === url.pathname &&
				navigationTarget.search === url.search;
			if (!isLiveMapWinner) return settlement;
			const recovery = pendingMapExit;
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
				`${recovery.restoreUrl.pathname}${recovery.restoreUrl.search}`,
				MAP_URL_REWRITE,
			);
			return 'recovered';
		},
	};
}
