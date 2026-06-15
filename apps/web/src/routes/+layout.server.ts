import type { LayoutServerLoad } from './$types';
import { pathLocale } from '$lib/i18n';

// Server layout load — a thin pass-through. The per-request /v1 fetch memo
// (`event.locals.v1Cache`) is initialised in hooks.server.ts, so it is already
// available to any server loader nested under this layout; nothing to set here.
//
// We forward the path-derived locale so the server data carries it too (the
// universal +layout.ts is the authoritative source for `lang`, but echoing it
// here keeps SSR data self-describing and lets server-only loaders read the
// locale off `data` without re-deriving it). No header work happens here —
// cache-control / no-Vary lives centrally in hooks.server.ts.
export const load: LayoutServerLoad = ({ url }) => {
	return { lang: pathLocale(url.pathname) };
};
