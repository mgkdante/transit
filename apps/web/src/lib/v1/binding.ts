// Cloudflare server transports for the `/v1` snapshot contract. SSR prefers the
// direct R2 bucket binding; the DATA service binding remains a compatibility
// fallback. Both adapt to the FetchFn shape used by the repositories.
//
// The v1 config can build relative local-dev paths or direct custom-domain URLs.
// R2 keys always start at `v1/`; the compatibility Worker continues to consume
// `/data/v1/...` paths.

import type { FetchFn } from '$lib/v1/http';
import {
	serveSnapshot,
	type R2BucketBinding,
} from '../../../../data-proxy/src/snapshot-response.js';
export type {
	R2ObjectBinding,
	R2BucketBinding,
} from '../../../../data-proxy/src/snapshot-response.js';

/** The minimal shape of a Cloudflare service binding we depend on. */
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

/** Serve SSR snapshot reads straight from R2, without invoking the proxy Worker. */
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

/**
 * Wrap a `DATA` service binding as a `FetchFn` that resolves the v1 adapter's
 * relative snapshot paths against `origin` before dispatching to the bound
 * Worker. Direct-R2 `/v1/*` URLs are mapped back to the compatibility Worker's
 * `/data/v1/*` route so the fallback remains valid after the public cutover.
 *
 * @param binding the `platform.env.DATA` service binding.
 * @param origin  the request origin (`url.origin`) to resolve relative paths against.
 */
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
