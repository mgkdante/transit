import { beforeNavigate } from '$app/navigation';
import { delocalizePath } from '$lib/i18n';
import type { MapSelectionController } from './mapSelectionController.svelte';

/**
 * Close route-owned detail state before leaving `/map`, without running the user
 * Close action's filter cleanup (and its competing in-place `goto`). Same-map
 * query rewrites deliberately keep the selection and panel alive.
 */
export function attachMapDetailRouteExit(
	controller: MapSelectionController,
): MapSelectionController {
	beforeNavigate(({ to }) => {
		if (!to || delocalizePath(to.url.pathname) === '/map') return;
		controller.close();
	});
	return controller;
}
