import type { ClientInit } from '@sveltejs/kit';
import { configureTransitUi } from '$lib/ui/configure';

export const init: ClientInit = configureTransitUi;
