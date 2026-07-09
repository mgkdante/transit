import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// _kit is the dev-only component gallery (the visual contract sheet). It is never
// linked from the app chrome and must not be reachable in production. `dev` is a
// compile-time constant (false in the prod build), so this guard 404s the route at
// the edge in prod while leaving it fully available under `bun run dev`.
export const load: PageLoad = () => {
	if (!dev) error(404, 'Not found');
	return {};
};
