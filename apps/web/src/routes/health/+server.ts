import { env as cloudflareEnv } from 'cloudflare:workers';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const prerender = false;

export const GET: RequestHandler = () => {
	const env = (cloudflareEnv ?? {}) as unknown as Record<string, string | undefined>;
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
