import type { ClientInit } from '@sveltejs/kit';
import { configureTransitUi } from '$lib/ui/configure';
import { dataRefresh, sharedClock } from '$lib/stores';
import { configureV1Runtime } from '$lib/v1/runtime';

export const init: ClientInit = () => {
	configureV1Runtime({ clock: sharedClock, refresh: dataRefresh });
	configureTransitUi();
};
