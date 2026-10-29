import { clock } from '@yesid/ui/state';
import type { ClientInit } from '@sveltejs/kit';
import { z } from 'zod';
import { configureTransitUi } from '$lib/ui/configure';
import { dataRefresh } from '$lib/stores';
import { configureV1Runtime } from '$lib/v1/runtime';

export const init: ClientInit = () => {
	// Zod's JIT probe calls `new Function`, which script-src blocks.
	z.config({ jitless: true });
	configureV1Runtime({ clock, refresh: dataRefresh });
	configureTransitUi();
};
