import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// transit.yesid.dev/health — liveness probe.
//
// Dynamic (prerender = false) so a 200 here proves the Pages Function/SSR runtime
// is alive, not just static asset serving. no-store so a monitor always hits the
// origin. CF_PAGES_* are surfaced when present (Git-integration builds).
export const prerender = false;

export const GET: RequestHandler = ({ platform }) => {
	const env = (platform?.env ?? {}) as Record<string, string | undefined>;
	return json(
		{
			status: 'ok',
			service: 'transit-web',
			commit: env.CF_PAGES_COMMIT_SHA ?? null,
			branch: env.CF_PAGES_BRANCH ?? null,
			time: new Date().toISOString(),
		},
		{ headers: { 'cache-control': 'no-store' } },
	);
};
