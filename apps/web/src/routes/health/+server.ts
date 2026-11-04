import { env as cloudflareEnv } from 'cloudflare:workers';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const prerender = false;

interface SnapshotBucket {
	get(key: string): Promise<{ text(): Promise<string> } | null>;
}

// Bound public probes to one read per 30 seconds per isolate, including failures.
const READ_TIMEOUT_MS = 3_000;
const MEMO_MS = 30_000;
let memo: { bucket: SnapshotBucket; until: number; result: Promise<boolean> } | undefined;

function canReadSnapshot(bucket: SnapshotBucket | undefined): Promise<boolean> {
	if (!bucket) return Promise.resolve(false);
	if (memo?.bucket === bucket && Date.now() < memo.until) return memo.result;
	const result = (async () => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				(async () => {
					const object = await bucket.get('v1/stm/manifest.json');
					if (!object) return false;
					const manifest: unknown = JSON.parse(await object.text());
					return (
						typeof manifest === 'object' &&
						manifest !== null &&
						'provider' in manifest &&
						manifest.provider === 'stm'
					);
				})(),
				new Promise<false>((resolve) => {
					timer = setTimeout(() => resolve(false), READ_TIMEOUT_MS);
				}),
			]);
		} catch {
			return false;
		} finally {
			clearTimeout(timer);
		}
	})();
	memo = { bucket, until: Date.now() + MEMO_MS, result };
	return result;
}

export const GET: RequestHandler = async () => {
	const env = (cloudflareEnv ?? {}) as unknown as {
		SNAPSHOTS?: SnapshotBucket;
		TRANSIT_COMMIT_SHA?: string;
		TRANSIT_BRANCH?: string;
	};
	const readable = await canReadSnapshot(env.SNAPSHOTS);
	return json(
		{
			status: readable ? 'ok' : 'unavailable',
			data: readable ? 'readable' : 'unavailable',
			service: 'transit-web',
			commit: env.TRANSIT_COMMIT_SHA ?? null,
			branch: env.TRANSIT_BRANCH ?? null,
			time: new Date().toISOString(),
		},
		{ status: readable ? 200 : 503, headers: { 'cache-control': 'no-store' } },
	);
};
