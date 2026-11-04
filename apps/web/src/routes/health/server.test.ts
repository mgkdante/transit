import { afterEach, expect, it, vi } from 'vitest';
import { GET } from './+server';
import { probeSites, SITE_CHECKS } from '../../../../../.github/scripts/site-probe.mjs';

const workers = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('cloudflare:workers', () => workers);

afterEach(() => {
	for (const key of Object.keys(workers.env)) delete workers.env[key];
	vi.resetModules();
	vi.useRealTimers();
});

it('returns 503 when its snapshot binding is unavailable instead of claiming ok', async () => {
	const response = await GET({} as Parameters<typeof GET>[0]);
	expect(response.status).toBe(503);
	expect(await response.json()).toMatchObject({
		status: 'unavailable',
		service: 'transit-web',
		data: 'unavailable',
		commit: null,
		branch: null,
	});
	expect(response.headers.get('cache-control')).toBe('no-store');
});

it('reads a real snapshot and reports the deployed commit and branch', async () => {
	workers.env.TRANSIT_COMMIT_SHA = 'b5b283781a6fe6ab12c424dd685bbb854d515962';
	workers.env.TRANSIT_BRANCH = 'main';
	workers.env.SNAPSHOTS = { get: vi.fn(async () => ({ text: async () => '{"provider":"stm"}' })) };
	const { GET: freshGET } = await import('./+server');
	const response = await freshGET({} as Parameters<typeof GET>[0]);
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		status: 'ok',
		data: 'readable',
		commit: 'b5b283781a6fe6ab12c424dd685bbb854d515962',
		branch: 'main',
	});
});

it.each([
	{ name: 'missing', get: async () => null },
	{
		name: 'denied',
		get: async () => {
			throw new Error('private upstream detail');
		},
	},
	{ name: 'corrupt', get: async () => ({ text: async () => 'not JSON' }) },
])('reports an unreadable $name snapshot without exposing upstream details', async ({ get }) => {
	workers.env.SNAPSHOTS = { get };
	const { GET: freshGET } = await import('./+server');
	const response = await freshGET({} as Parameters<typeof GET>[0]);
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain('private upstream detail');
});

it('coalesces reads, expires the memo and recovers after a storage outage', async () => {
	vi.useFakeTimers();
	const get = vi.fn().mockResolvedValue(null);
	workers.env.SNAPSHOTS = { get };
	const { GET: freshGET } = await import('./+server');
	const request = () => freshGET({} as Parameters<typeof GET>[0]);
	expect((await Promise.all([request(), request()])).map((r) => r.status)).toEqual([503, 503]);
	expect(get).toHaveBeenCalledTimes(1);
	get.mockResolvedValue({ text: async () => '{"provider":"stm"}' });
	await vi.advanceTimersByTimeAsync(30_001);
	expect((await request()).status).toBe(200);
	expect(get).toHaveBeenCalledTimes(2);
});

it('bounds a hung storage read and memoizes the failure', async () => {
	vi.useFakeTimers();
	const get = vi.fn(() => new Promise(() => {}));
	workers.env.SNAPSHOTS = { get };
	const { GET: freshGET } = await import('./+server');
	const pending = freshGET({} as Parameters<typeof GET>[0]);
	await vi.advanceTimersByTimeAsync(3_001);
	expect((await pending).status).toBe(503);
	expect((await freshGET({} as Parameters<typeof GET>[0])).status).toBe(503);
	expect(get).toHaveBeenCalledTimes(1);
});

it('coalesces concurrent healthy reads and keeps their thirty-second memo', async () => {
	vi.useFakeTimers();
	const get = vi.fn(async () => ({ text: async () => '{"provider":"stm"}' }));
	workers.env.SNAPSHOTS = { get };
	const { GET: freshGET } = await import('./+server');
	const request = () => freshGET({} as Parameters<typeof GET>[0]);
	expect((await Promise.all([request(), request()])).map((response) => response.status)).toEqual([
		200, 200,
	]);
	await vi.advanceTimersByTimeAsync(29_999);
	expect((await request()).status).toBe(200);
	expect(get).toHaveBeenCalledTimes(1);
	await vi.advanceTimersByTimeAsync(2);
	expect((await request()).status).toBe(200);
	expect(get).toHaveBeenCalledTimes(2);
});

it('lets the real site probe observe storage recovery on its retry instead of alerting on a cached failure', async () => {
	vi.useFakeTimers();
	workers.env.TRANSIT_COMMIT_SHA = '02f3d787b20021fb5d558416c2e9fa68c471d499';
	workers.env.TRANSIT_BRANCH = 'main';
	const get = vi
		.fn()
		.mockResolvedValueOnce(null)
		.mockResolvedValue({
			text: async () => '{"provider":"stm"}',
		});
	workers.env.SNAPSHOTS = { get };
	const { GET: freshGET } = await import('./+server');
	const statuses: number[] = [];
	const alert = vi.fn();
	const result = await probeSites({
		checks: SITE_CHECKS.filter((check) => check.kind === 'health'),
		fetchFn: async () => {
			const response = await freshGET({} as Parameters<typeof GET>[0]);
			statuses.push(response.status);
			return response;
		},
		pause: async (ms: number) => {
			await vi.advanceTimersByTimeAsync(ms);
		},
		alert,
	});
	expect.soft(statuses).toEqual([503, 200]);
	expect.soft(get).toHaveBeenCalledTimes(2);
	expect.soft(result).toBe(0);
	expect(alert).toHaveBeenCalledExactlyOnceWith('resolve', 'site-availability', expect.any(String));
});
