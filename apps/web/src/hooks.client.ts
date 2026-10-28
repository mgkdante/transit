import { clock } from '@yesid/ui/state';
import type { ClientInit } from '@sveltejs/kit';
import { configureTransitUi } from '$lib/ui/configure';
import { dataRefresh } from '$lib/stores';
import { configureV1Runtime } from '$lib/v1/runtime';

export const init: ClientInit = () => {
	configureV1Runtime({ clock, refresh: dataRefresh });
	configureTransitUi();
};
