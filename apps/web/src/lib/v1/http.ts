// v1 HTTP layer — the single fetch+validate primitive for the R2 adapter.
//
// Fail-soft contract (snapshots/contract.py §404-as-empty):
//   - HTTP 404  -> `undefined`  ("no data for this entity"; the caller renders
//                                 an empty state, NOT an error). Per-entity
//                                 static/historic pointers rely on this.
//   - HTTP 5xx  -> throw         (server/transport fault — a real error).
//   - other !ok -> throw         (401/403/4xx misconfig are bugs, not empties).
//   - parse fail -> throw        (contract drift; parsePort names the port).
//
// Every response body crosses the R2 -> client trust boundary as unknown-shaped
// JSON, so we hand it to `parsePort(label, schema, value)` which validates and,
// on failure, throws an error naming the port that produced the bad data.
//
// `fetchFn` is the caller-supplied fetch — SvelteKit threads `event.fetch` here
// during SSR so requests are deduped/inlined into the server-rendered payload.
// It defaults to the global `fetch` (browser / client-side refresh).

import { browser } from '$app/environment';
import type { z } from 'zod';
import { parsePort } from '$lib/v1/schemas/parse';
import { sharedClock } from '$lib/stores/clock.svelte';

/**
 * Browser-only: estimate the SERVER's current time from a response and feed it
 * to the shared clock so every freshness readout is anchored to server time
 * (skew-immune), not the client's possibly-wrong clock.
 *
 *   serverEpochMs = Date.parse(<Date header>) + (<Age header> seconds * 1000)
 *
 * The `Date` header is the origin's response time; the `Age` header is how long
 * the response sat in an intermediary cache. The live file is
 * `cache-control: max-age=30`, so a cached hit can be up to ~30s old — adding
 * `Age` makes the estimate the server's CURRENT time at RECEIPT, not when the
 * body was first generated (without it freshness would over-report by up to 30s
 * and could falsely flip stale at the 2x-ttl=60s threshold). Fail-soft: skips
 * silently with no `Date` header / on a NaN parse; never throws (SSR-safe — the
 * whole call is browser-gated, and the server's own clock is already accurate).
 */
function noteServerTime(res: Response): void {
	if (!browser) return;
	const dateHeader = res.headers.get('date');
	if (!dateHeader) return;
	const dateMs = Date.parse(dateHeader);
	if (Number.isNaN(dateMs)) return;
	const ageMs = (Number.parseInt(res.headers.get('age') ?? '0', 10) || 0) * 1000;
	sharedClock.noteServerEpochMs(dateMs + ageMs);
}

/** A fetch-shaped function. Matches both the global `fetch` and SvelteKit's `event.fetch`. */
export type FetchFn = typeof fetch;

/** Per-request fetch options passed through to the adapter ports. */
export interface FetchCtx {
	/** SSR-supplied fetch (event.fetch) for request dedupe; defaults to global fetch. */
	fetch?: FetchFn;
	/**
	 * Cache mode forwarded to the underlying request. Stable mutable URLs use
	 * normal HTTP revalidation (`default`); generation-addressed immutable
	 * artifacts may use the platform/browser cache (`force-cache`).
	 */
	cache?: RequestCache;
	/** Optional AbortSignal to cancel an in-flight read. */
	signal?: AbortSignal;
}

export interface RawJsonEntity<T> {
	readonly value: T;
	readonly bytes: Uint8Array;
}

type JsonRequestInit = {
	cache?: RequestCache;
	signal?: AbortSignal;
	serverErrorRetries?: number;
};

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException
		? error.name === 'AbortError'
		: error instanceof Error && error.name === 'AbortError';
}

async function requestJsonResponse(
	url: string,
	label: string,
	fetchFn: FetchFn,
	init?: JsonRequestInit,
): Promise<Response | undefined> {
	let serverErrorRetries = init?.serverErrorRetries ?? 0;
	while (true) {
		const res = await fetchFn(url, {
			headers: { accept: 'application/json' },
			cache: browser ? init?.cache : undefined,
			signal: init?.signal,
		});

		noteServerTime(res);
		if (res.status === 404) return undefined;
		if (!res.ok) {
			if (res.status >= 500 && res.status <= 599 && serverErrorRetries > 0) {
				serverErrorRetries -= 1;
				continue;
			}
			throw new Error(`[v1.${label}] HTTP ${res.status} ${res.statusText} for ${url}`);
		}
		return res;
	}
}

function invalidJson(label: string, url: string, cause: unknown): never {
	if (isAbortError(cause)) throw cause;
	throw new Error(`[v1.${label}] invalid JSON from ${url}`, { cause });
}

function validateJson<T>(schema: z.ZodType<T>, label: string, body: unknown): T {
	return parsePort(label, schema, body);
}

/**
 * Fetch JSON from a snapshot URL and validate it through `parsePort`.
 *
 * @returns the parsed value, or `undefined` when the URL 404s (no data).
 * @throws on 5xx / non-404 !ok responses and on schema-validation failure.
 *
 * @param url      fully-qualified snapshot URL (built by config.ts helpers).
 * @param schema   the Zod schema for this family (from `$lib/v1/schemas`).
 * @param label    port label for parse errors, e.g. `"static.route"`.
 * @param fetchFn  fetch implementation (event.fetch in SSR; global fetch else).
 * @param init     optional cache mode + abort signal.
 */
export async function getEntityJson<T>(
	url: string,
	schema: z.ZodType<T>,
	label: string,
	fetchFn: FetchFn = fetch,
	init?: JsonRequestInit,
): Promise<T | undefined> {
	const res = await requestJsonResponse(url, label, fetchFn, init);
	if (res === undefined) return undefined;

	let body: unknown;
	try {
		body = await res.json();
	} catch (cause) {
		invalidJson(label, url, cause);
	}

	return validateJson(schema, label, body);
}

export async function getEntityJsonWithBytes<T>(
	url: string,
	schema: z.ZodType<T>,
	label: string,
	fetchFn: FetchFn = fetch,
	init?: JsonRequestInit,
): Promise<RawJsonEntity<T> | undefined> {
	const res = await requestJsonResponse(url, label, fetchFn, init);
	if (res === undefined) return undefined;

	let bytes: Uint8Array;
	let body: unknown;
	try {
		bytes = new Uint8Array(await res.arrayBuffer());
		body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch (cause) {
		invalidJson(label, url, cause);
	}

	return { value: validateJson(schema, label, body), bytes };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const input =
		bytes.buffer instanceof ArrayBuffer
			? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
			: new Uint8Array(bytes);
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
