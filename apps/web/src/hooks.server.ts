import type { Handle, ServerInit } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { pathLocale } from '$lib/i18n';
import { readPublicSiteConfig } from '$lib/site/config';
import { securityHeaders } from '$lib/site/securityHeaders';
import { configureTransitUi } from '$lib/ui/configure';

export const init: ServerInit = configureTransitUi;

const HTML_EDGE_TTL_S = 30;
const HTML_EDGE_CACHE_NAME = 'transit-html-v1';
const HTML_EDGE_CACHE_CONTROL = `public, max-age=0, s-maxage=${HTML_EDGE_TTL_S}`;
const HTML_PUBLIC_CACHE_CONTROL = 'no-store';
const EDGE_CACHE_STATUS = 'x-transit-edge-cache';

interface EdgeCache {
	match(request: RequestInfo | URL): Promise<Response | undefined>;
	put(request: RequestInfo | URL, response: Response): Promise<void>;
}

async function edgeCache(platform: App.Platform | undefined): Promise<EdgeCache | undefined> {
	try {
		return (await platform?.caches?.open(HTML_EDGE_CACHE_NAME)) as EdgeCache | undefined;
	} catch {
		return undefined;
	}
}

function cacheKey(url: URL): Request {
	return new Request(url.toString(), { method: 'GET' });
}

function requestBypassesHtmlCache(request: Request): boolean {
	if (request.method !== 'GET' && request.method !== 'HEAD') return true;
	if (
		request.headers.has('cookie') ||
		request.headers.has('authorization') ||
		request.headers.has('range')
	) {
		return true;
	}
	const cacheControl = request.headers.get('cache-control')?.toLowerCase() ?? '';
	return /(?:^|,)\s*no-(?:cache|store)(?:\s*(?:=|,|$))/.test(cacheControl);
}

function isHtml(response: Response): boolean {
	return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

function responseCanEnterHtmlCache(response: Response): boolean {
	if (response.status !== 200 || !isHtml(response) || response.headers.has('set-cookie'))
		return false;
	const cacheControl = response.headers.get('cache-control')?.toLowerCase() ?? '';
	if (/(?:^|,)\s*(?:private|no-cache|no-store)(?:\s*(?:=|,|$))/.test(cacheControl)) return false;
	return response.headers.get('vary')?.trim() !== '*';
}

function mutableResponse(response: Response, head = false): Response {
	return new Response(head ? null : response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

function applyDocumentHeaders(response: Response): void {
	for (const [name, value] of Object.entries(securityHeaders({ dev }))) {
		response.headers.set(name, value);
	}

	if (!readPublicSiteConfig().indexing) {
		response.headers.set('x-robots-tag', 'noindex, nofollow');
	}
}

// Server hooks — the request-time plumbing for the transit web app.
//
// Two jobs, both per-request and CDN-safe (adapted from yesid.dev slice-28.6):
//
//   1. i18n <html lang>. app.html ships `<html lang="%lang%">`; the locale is
//      PATH-DERIVED (pathLocale), so every URL is exactly one cacheable
//      representation. We deliberately set NO `Vary` header — the lang is a
//      function of the path, never of a request header, so a CDN can cache the
//      EN and FR variants independently by URL. Error renders (which carry no
//      route params) still get the right lang because the path always does.
//
//   2. Per-request /v1 fetch memo. `event.locals.v1Cache` is a fresh Map per
//      HTTP request: the manifest + labels (and any other /v1 read that opts in)
//      are fetched once per SSR request and reused across loaders within that
//      request, then discarded. One Map per request = no cross-request leakage.
//      Typed as `App.Locals.v1Cache` in src/app.d.ts.

export const handle: Handle = async ({ event, resolve }) => {
	// Per-request /v1 fetch memo — discarded when the request ends.
	event.locals.v1Cache = new Map();

	// Path-derived locale → <html lang>. No Vary header: the representation is a
	// pure function of the URL path, so each URL is independently cacheable.
	const lang = pathLocale(event.url.pathname);
	event.locals.locale = lang;
	const cache = await edgeCache(event.platform);
	const cacheBypassed = cache == null || requestBypassesHtmlCache(event.request);
	const key = cacheBypassed ? null : cacheKey(event.url);

	if (cache != null && key != null) {
		let hit: Response | undefined;
		try {
			hit = await cache.match(key);
		} catch {
			// Edge cache is an optimization. SSR remains the fail-open authority.
		}
		if (hit != null && responseCanEnterHtmlCache(hit)) {
			const response = mutableResponse(hit, event.request.method === 'HEAD');
			applyDocumentHeaders(response);
			response.headers.set('cache-control', HTML_PUBLIC_CACHE_CONTROL);
			response.headers.set(EDGE_CACHE_STATUS, 'HIT');
			return response;
		}
	}

	const resolved = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', lang),
		preload: ({ type }) => type !== 'js',
	});
	const response = mutableResponse(resolved, event.request.method === 'HEAD');

	// Security headers on the SSR-rendered document. The static `_headers` file
	// only covers static *assets* in Worker mode, so without this every HTML
	// document shipped zero CSP/HSTS/frame protection. Source of truth +
	// _headers parity gate: $lib/site/securityHeaders.
	applyDocumentHeaders(response);

	if (cache != null) {
		if (key != null && event.request.method === 'GET' && responseCanEnterHtmlCache(response)) {
			const stored = response.clone();
			stored.headers.set('cache-control', HTML_EDGE_CACHE_CONTROL);
			stored.headers.delete(EDGE_CACHE_STATUS);
			const write = cache.put(key, stored).catch(() => undefined);
			const context = event.platform?.ctx ?? event.platform?.context;
			if (context != null) context.waitUntil(write);
			else await write;
			response.headers.set('cache-control', HTML_PUBLIC_CACHE_CONTROL);
			response.headers.set(EDGE_CACHE_STATUS, 'MISS');
		} else {
			response.headers.set(EDGE_CACHE_STATUS, 'BYPASS');
		}
	}
	return response;
};
