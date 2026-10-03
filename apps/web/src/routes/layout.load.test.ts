import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
	bootProvider: vi.fn(),
	serverV1Context: vi.fn(),
}));

vi.mock('$lib/v1/boot', () => ({
	bootProvider: (...args: unknown[]) => harness.bootProvider(...args),
}));

vi.mock('$lib/v1/serverContext', () => ({
	serverV1Context: (...args: unknown[]) => harness.serverV1Context(...args),
}));

import { load as loadServerLayout } from './+layout.server';
import { load as loadUniversalLayout } from './+layout';

const manifest = {
	provider: 'stm',
	generated_utc: '2026-07-15T12:00:00Z',
	labels: {},
};

function v1(lang: 'en' | 'fr', version: string) {
	return { manifest: { ...manifest, version }, labels: {}, lang };
}

function selection(context: ReturnType<typeof v1> | null) {
	return {
		providerId: 'stm',
		provider: null,
		providers: [],
		discoveryError: false,
		redirectHref: null,
		v1: context,
	};
}

function serverEvent(lang: 'fr' | undefined, pathname: string, binding = true) {
	return {
		params: lang ? { lang } : {},
		url: new URL(`https://transit.yesid.dev${pathname}`),
		fetch: vi.fn(),
		locals: { v1Cache: new Map<string, unknown>() } as {
			v1Cache: Map<string, unknown>;
			locale?: 'en' | 'fr';
		},
		platform: binding ? { env: { DATA: { fetch: vi.fn() } } } : undefined,
	} as unknown as Parameters<typeof loadServerLayout>[0];
}

function universalEvent(
	lang: 'en' | 'fr',
	pathname: string,
	serverV1: ReturnType<typeof v1> | null,
	serverBoot: 'skipped' | 'succeeded' | 'failed' = serverV1 ? 'succeeded' : 'skipped',
) {
	return {
		url: new URL(`https://transit.yesid.dev${pathname}`),
		fetch: vi.fn(),
		data: { ...selection(serverV1), lang, serverBoot },
	} as unknown as Parameters<typeof loadUniversalLayout>[0];
}

beforeEach(() => {
	harness.bootProvider.mockReset();
	harness.serverV1Context.mockReset();
});

describe('root server layout boot', () => {
	it('derives locale from the validated route param and boots through the per-request server context', async () => {
		const request = serverEvent('fr', '/network');
		const context = { fetch: vi.fn(), cache: request.locals.v1Cache };
		const booted = v1('fr', 'one');
		harness.serverV1Context.mockReturnValue(context);
		harness.bootProvider.mockResolvedValue(selection(booted));

		await expect(loadServerLayout(request)).resolves.toMatchObject({
			lang: 'fr',
			v1: booted,
			serverBoot: 'succeeded',
		});
		expect(harness.serverV1Context).toHaveBeenCalledWith(request);
		expect(harness.bootProvider).toHaveBeenCalledWith(request.url, 'fr', context);
		expect(context.cache).toBe(request.locals.v1Cache);
	});

	it('keeps the unprefixed locale fallback when no validated locale param is present', async () => {
		const request = serverEvent(undefined, '/fr/network', false);

		await expect(loadServerLayout(request)).resolves.toMatchObject({
			lang: 'en',
			v1: null,
			serverBoot: 'skipped',
		});
		expect(harness.bootProvider).not.toHaveBeenCalled();
		expect(harness.serverV1Context).not.toHaveBeenCalled();
	});

	it('uses the request locale when an error render has no validated route param', async () => {
		const request = serverEvent(undefined, '/fr/missing-route', false);
		request.locals.locale = 'fr';

		await expect(loadServerLayout(request)).resolves.toMatchObject({
			lang: 'fr',
			v1: null,
			serverBoot: 'skipped',
		});
	});

	it('records one failed bound boot so the universal loader does not repeat it server-side', async () => {
		const request = serverEvent(undefined, '/network');
		harness.serverV1Context.mockReturnValue({ fetch: vi.fn(), cache: request.locals.v1Cache });
		harness.bootProvider.mockResolvedValue(selection(null));

		await expect(loadServerLayout(request)).resolves.toMatchObject({
			lang: 'en',
			v1: null,
			serverBoot: 'failed',
		});
	});
});

describe('root universal layout boot', () => {
	it('uses the locale supplied by the server layout without tracking the pathname', async () => {
		const booted = v1('fr', 'one');
		const request = universalEvent('fr', '/network', booted);

		await expect(loadUniversalLayout(request)).resolves.toMatchObject({
			lang: 'fr',
			v1: booted,
			v1Error: false,
		});
		expect(harness.bootProvider).not.toHaveBeenCalled();
	});

	it('reboots a missing server context on every load invocation so invalidateAll stays effective', async () => {
		const request = universalEvent('fr', '/network', null);
		const first = v1('fr', 'one');
		const second = v1('fr', 'two');
		harness.bootProvider
			.mockResolvedValueOnce(selection(first))
			.mockResolvedValueOnce(selection(second));

		await expect(loadUniversalLayout(request)).resolves.toMatchObject({
			lang: 'fr',
			v1: first,
			v1Error: false,
		});
		await expect(loadUniversalLayout(request)).resolves.toMatchObject({
			lang: 'fr',
			v1: second,
			v1Error: false,
		});
		expect(harness.bootProvider).toHaveBeenNthCalledWith(1, request.url, 'fr', {
			fetch: request.fetch,
		});
		expect(harness.bootProvider).toHaveBeenNthCalledWith(2, request.url, 'fr', {
			fetch: request.fetch,
		});
	});

	it('does not repeat a failed bound boot through the universal server path', async () => {
		const request = universalEvent('en', '/network', null, 'failed');

		await expect(loadUniversalLayout(request)).resolves.toMatchObject({
			lang: 'en',
			v1: null,
			v1Error: true,
		});
		expect(harness.bootProvider).not.toHaveBeenCalled();
	});
});
