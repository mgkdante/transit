// Cloudflare server transports for the `/v1` snapshot contract. SSR prefers the
// direct R2 bucket binding; the DATA service binding remains a compatibility
// fallback. Both adapt to the FetchFn shape used by the repositories.
//
// The v1 config can build relative local-dev paths or direct custom-domain URLs.
// R2 keys always start at `v1/`; the compatibility Worker continues to consume
// `/data/v1/...` paths.

import type { FetchFn } from '$lib/v1/http';

/** The minimal shape of a Cloudflare service binding we depend on. */
export interface ServiceBinding {
	fetch: typeof fetch;
}

export interface R2ObjectBinding {
	readonly body?: BodyInit | null;
	readonly httpEtag: string;
	readonly uploaded?: Date;
	readonly size?: number;
	readonly range?: { readonly offset?: number; readonly length?: number };
	writeHttpMetadata(headers: Headers): void;
}

export interface R2BucketBinding {
	get(
		key: string,
		options?: { readonly onlyIf?: Headers; readonly range?: Headers },
	): Promise<R2ObjectBinding | null>;
	head?(key: string): Promise<R2ObjectBinding | null>;
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

function ifMatchSatisfied(value: string, httpEtag: string): boolean {
	return (
		value.trim() === '*' || value.split(',').some((candidate) => candidate.trim() === httpEtag)
	);
}

function ifUnmodifiedSinceSatisfied(value: string, uploaded: Date | undefined): boolean {
	const timestamp = Date.parse(value);
	if (Number.isNaN(timestamp)) return true;
	return uploaded !== undefined && uploaded.getTime() <= timestamp;
}

function failedConditionalStatus(headers: Headers, object: R2ObjectBinding): 304 | 412 {
	const ifMatch = headers.get('if-match');
	if (ifMatch !== null) {
		if (!ifMatchSatisfied(ifMatch, object.httpEtag)) return 412;
	} else {
		const ifUnmodifiedSince = headers.get('if-unmodified-since');
		if (
			ifUnmodifiedSince !== null &&
			!ifUnmodifiedSinceSatisfied(ifUnmodifiedSince, object.uploaded)
		) {
			return 412;
		}
	}

	return headers.has('if-none-match') || headers.has('if-modified-since') ? 304 : 412;
}

function hasConditionalHeaders(headers: Headers): boolean {
	return (
		headers.has('if-match') ||
		headers.has('if-none-match') ||
		headers.has('if-modified-since') ||
		headers.has('if-unmodified-since')
	);
}

function isR2InvalidRange(error: unknown): boolean {
	return error instanceof Error && /\(10039\)\s*$/.test(error.message);
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
		const conditionalHead = request.method === 'HEAD' && hasConditionalHeaders(request.headers);
		const rangeHeader = request.method === 'GET' ? request.headers.get('range') : null;

		let object: R2ObjectBinding | null;
		try {
			object =
				request.method === 'HEAD' && bucket.head && !conditionalHead
					? await bucket.head(key)
					: await bucket.get(key, {
							onlyIf: request.headers,
							...(rangeHeader !== null ? { range: request.headers } : {}),
						});
		} catch (error) {
			if (rangeHeader !== null && isR2InvalidRange(error)) {
				return new Response(null, {
					status: 416,
					headers: { 'accept-ranges': 'bytes', 'cache-control': 'no-store' },
				});
			}
			throw error;
		}
		if (object === null) return new Response(null, { status: 404 });

		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set('etag', object.httpEtag);
		headers.set('accept-ranges', 'bytes');
		if (request.method === 'HEAD') {
			if (conditionalHead && object.body == null) {
				const status = failedConditionalStatus(request.headers, object);
				if (status === 412) headers.set('cache-control', 'no-store');
				return new Response(null, { status, headers });
			}
			return new Response(null, { status: 200, headers });
		}
		if (object.body == null) {
			const status = failedConditionalStatus(request.headers, object);
			if (status === 412) headers.set('cache-control', 'no-store');
			return new Response(null, { status, headers });
		}

		if (rangeHeader !== null && object.range && object.size !== undefined) {
			const offset = object.range.offset ?? 0;
			const length = object.range.length ?? object.size - offset;
			headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
			headers.set('content-length', String(length));
			return new Response(object.body, { status: 206, headers });
		}
		return new Response(object.body, { status: 200, headers });
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
