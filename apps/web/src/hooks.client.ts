import type { ClientInit } from '@sveltejs/kit/hooks';
import { clock } from '@yesid/ui/state';
import { z } from 'zod';
import { pageDataFetch } from '#lib/site/pageDataFetch.ts';
import { configureTransitUi } from '#lib/ui/configure.ts';
import { dataRefresh } from '#lib/stores/index.ts';
import { configureV1Runtime } from '#lib/v1/runtime.ts';

export const init: ClientInit = () => {
	window.fetch = pageDataFetch(window.fetch.bind(window), window.location.origin);
	// Zod's JIT probe calls `new Function`, which script-src blocks.
	z.config({ jitless: true });
	configureV1Runtime({ clock, refresh: dataRefresh });
	configureTransitUi();
};
