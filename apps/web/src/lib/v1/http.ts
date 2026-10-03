import { browser } from '$app/environment';
import type { z } from 'zod';
import { parsePort } from '$lib/v1/schemas/parse';
import { getV1Runtime } from '$lib/v1/runtime';

const MAX_SERVER_TIME_CALIBRATION_AGE_S = 30;

function noteServerTime(res: Response): void {
	if (!browser) return;
	const dateHeader = res.headers.get('date');
	if (!dateHeader) return;
	const dateMs = Date.parse(dateHeader);
	if (Number.isNaN(dateMs)) return;
	const parsedAgeSeconds = Number.parseInt(res.headers.get('age') ?? '0', 10);
	const ageSeconds = Math.max(0, Number.isFinite(parsedAgeSeconds) ? parsedAgeSeconds : 0);
	if (ageSeconds > MAX_SERVER_TIME_CALIBRATION_AGE_S) return;
	getV1Runtime().clock.noteServerEpochMs(dateMs + ageSeconds * 1000);
}

export type FetchFn = typeof fetch;

export interface FetchCtx {
	fetch?: FetchFn;
	cache?: RequestCache;
	signal?: AbortSignal;
}

export interface RawJsonEntity<T> {
	readonly value: T;
	readonly bytes: Uint8Array;
}

type JsonRequestInit = {
	providerId?: string;
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

	return parsePort(label, schema, body, init?.providerId);
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

	return { value: parsePort(label, schema, body, init?.providerId), bytes };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const input =
		bytes.buffer instanceof ArrayBuffer
			? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
			: new Uint8Array(bytes);
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
