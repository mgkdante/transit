import type { FetchFn } from '$lib/v1/http';
import {
	serveSnapshot,
	type R2BucketBinding,
} from '../../../../data-proxy/src/snapshot-response.js';
export type {
	R2ObjectBinding,
	R2BucketBinding,
} from '../../../../data-proxy/src/snapshot-response.js';

export interface ServiceBinding {
	fetch: typeof fetch;
}

function targetUrl(input: Parameters<typeof fetch>[0], origin: string): URL {
	return typeof input === 'string'
		? new URL(input, origin)
		: input instanceof URL
			? input
			: new URL(input.url);
}

function r2Key(input: Parameters<typeof fetch>[0], origin: string): string | null {
	const target = targetUrl(input, origin);
	let pathname: string;
	try {
		pathname = decodeURIComponent(target.pathname);
	} catch {
		return null;
	}
	const key = pathname.startsWith('/data/v1/')
		? pathname.slice('/data/'.length)
		: pathname.startsWith('/v1/')
			? pathname.slice(1)
			: null;
	return key !== null && !key.includes('..') ? key : null;
}

export function r2BucketFetch(bucket: R2BucketBinding, origin: string): FetchFn {
	const fn = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
		const request =
			input instanceof Request
				? new Request(input, init)
				: new Request(targetUrl(input, origin), init);
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
		}
		const key = r2Key(input, origin);
		if (key === null) return new Response(null, { status: 404 });
		return (await serveSnapshot(request, bucket, key)) ?? new Response(null, { status: 404 });
	};
	return fn as FetchFn;
}

export function bindingFetch(binding: ServiceBinding, origin: string): FetchFn {
	const fn = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
		const resolved = targetUrl(input, origin);
		if (resolved.pathname.startsWith('/v1/')) {
			const compatibilityUrl = new URL(`/data${resolved.pathname}${resolved.search}`, origin);
			if (input instanceof Request) {
				return binding.fetch(new Request(compatibilityUrl, new Request(input, init)));
			}
			return binding.fetch(compatibilityUrl, init);
		}

		const target = input instanceof Request ? new Request(input, init) : resolved;
		return binding.fetch(
			target as Parameters<typeof fetch>[0],
			input instanceof Request ? undefined : init,
		);
	};
	return fn as FetchFn;
}
