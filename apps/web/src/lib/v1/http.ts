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
	 * Cache mode forwarded to the underlying request. The live tier wants
	 * fresh-ish reads ('no-cache' / 'default'); static + historic tiers are
	 * long-TTL and can use the platform/browser cache ('force-cache').
	 */
	cache?: RequestCache;
	/** Optional AbortSignal to cancel an in-flight read. */
	signal?: AbortSignal;
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
	init?: { cache?: RequestCache; signal?: AbortSignal },
): Promise<T | undefined> {
	// The `cache` REQUEST mode (e.g. 'force-cache' for long-TTL tiers) is a
	// browser-only concern: workerd / SvelteKit's SSR `server_fetch` rejects
	// unsupported modes ("Unsupported cache mode: force-cache"). Server-side,
	// caching is governed by Cloudflare's edge + the snapshot's `cache-control`
	// response headers, so we forward the request cache mode in the browser only.
	const res = await fetchFn(url, {
		headers: { accept: 'application/json' },
		cache: browser ? init?.cache : undefined,
		signal: init?.signal,
	});

	// Anchor the shared freshness clock to server time (browser-only, fail-soft).
	// Done before the 404/!ok branches so even a 404/error response with a `Date`
	// header still corrects the offset.
	noteServerTime(res);

	// 404 is the contract's "no data for this entity" signal — render empty.
	if (res.status === 404) return undefined;

	// Anything else non-ok (5xx transport faults, 4xx misconfig) is a real error.
	if (!res.ok) {
		throw new Error(`[v1.${label}] HTTP ${res.status} ${res.statusText} for ${url}`);
	}

	let body: unknown;
	try {
		body = await res.json();
	} catch (cause) {
		throw new Error(`[v1.${label}] invalid JSON from ${url}`, { cause });
	}

	// parsePort throws a labelled error on contract drift.
	return parsePort(label, schema, body);
}
