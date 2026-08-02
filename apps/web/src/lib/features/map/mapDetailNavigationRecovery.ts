import { beforeNavigate } from '$app/navigation';
import { delocalizePath } from '$lib/i18n';
import { MAP_URL_REWRITE, type MapUrlNavigate, type MapUrlSettlement } from './mapUrlCoordinator';

interface MapDetailNavigationRecoveryOptions {
	readonly currentUrl: () => URL;
	readonly goto: MapUrlNavigate;
}

export interface MapDetailNavigationRecovery {
	settle(
		url: URL,
		settleUrl: (url: URL) => MapUrlSettlement,
		navigationTarget: URL | null,
	): MapUrlSettlement | 'recovered';
}

type PendingMapExit = {
	readonly restoreUrl: URL;
	readonly focusTarget: HTMLElement | null;
};

/**
 * Records reversible detail state for a non-map attempt and intercepts only an
 * in-flight redirect/supersession that settles back on the live map.
 */
export function attachMapDetailNavigationRecovery(
	options: MapDetailNavigationRecoveryOptions,
): MapDetailNavigationRecovery {
	let pendingMapExit: PendingMapExit | null = null;

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

		const detailSurface = document.querySelector<HTMLElement>(
			'[data-slot="map-detail-overlay"], [data-m6c2-detail-sheet]',
		);
		if (!detailSurface) return;
		const activeElement = document.activeElement;
		pendingMapExit = {
			restoreUrl: options.currentUrl(),
			focusTarget:
				activeElement instanceof HTMLElement && detailSurface.contains(activeElement)
					? activeElement
					: null,
		};
	});

	return {
		settle(url, settleUrl, navigationTarget) {
			const settlement = settleUrl(url);
			if (pendingMapExit == null || delocalizePath(url.pathname) !== '/map') return settlement;
			const recovery = pendingMapExit;
			pendingMapExit = null;
			const isPlainMap = url.search === '';
			const isExactRestore =
				navigationTarget != null &&
				navigationTarget.pathname === url.pathname &&
				navigationTarget.search === url.search &&
				url.pathname === recovery.restoreUrl.pathname &&
				url.search === recovery.restoreUrl.search &&
				recovery.focusTarget?.isConnected === true &&
				document.activeElement === recovery.focusTarget;
			if (settlement !== 'adopt' || (!isPlainMap && !isExactRestore)) return settlement;
			if (recovery.focusTarget?.isConnected) {
				recovery.focusTarget.focus({ preventScroll: true });
			}
			void options.goto(
				`${recovery.restoreUrl.pathname}${recovery.restoreUrl.search}`,
				MAP_URL_REWRITE,
			);
			return 'recovered';
		},
	};
}
