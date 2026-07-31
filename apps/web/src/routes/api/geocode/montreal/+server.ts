import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { googlePlaceDetails, googlePlacesAutocompleteSuggestions } from '$lib/geocode/googlePlaces';
import { geocodeMontreal, geocodeMontrealSuggestions } from '$lib/geocode/nominatim';
import {
	GEOCODE_RATE_LIMIT,
	TokenBucketLimiter,
	type TokenBucketDecision,
} from '$lib/geocode/rateLimit.server';
import { isGooglePlacesSessionToken } from '$lib/geocode/sessionToken';

export const prerender = false;

const QUERY_MAX_CODE_POINTS = 160;
const PLACE_ID_MAX_CODE_POINTS = 255;
const NATIVE_RATE_WINDOW_SECONDS = 60;
const MISSING_IP_KEY = '__missing_cf_connecting_ip__';
const CONTROL_CHARACTER = /\p{Cc}/u;

const trustedIpLimiter = new TokenBucketLimiter(GEOCODE_RATE_LIMIT.trusted, {
	ttlMs: GEOCODE_RATE_LIMIT.bucketTtlMs,
	maxEntries: GEOCODE_RATE_LIMIT.maxTrustedEntries,
});
const missingIpLimiter = new TokenBucketLimiter(GEOCODE_RATE_LIMIT.missingIp, {
	ttlMs: GEOCODE_RATE_LIMIT.bucketTtlMs,
	maxEntries: GEOCODE_RATE_LIMIT.maxMissingIpEntries,
});

type ParsedGeocodeRequest =
	| {
			readonly mode: 'details';
			readonly placeId: string;
			readonly sessionToken: string;
	  }
	| {
			readonly mode: 'query';
			readonly query: string;
			readonly suggest: boolean;
			readonly sessionToken: string | null;
	  };

type ParseResult =
	| { readonly ok: true; readonly value: ParsedGeocodeRequest }
	| { readonly ok: false; readonly error: string };

export const GET: RequestHandler = async ({ url, request, fetch, platform }) => {
	// Frozen order: provenance → exact-one-mode parsing/validation → rate → provider.
	// Rejecting before the rate/provider stages keeps hostile or malformed traffic
	// from spending either bucket tokens or provider calls.
	if (!hasSameOriginProvenance(request.headers, url.origin)) {
		return json({ error: 'forbidden' }, { status: 403, headers: { 'cache-control': 'no-store' } });
	}

	const parsed = parseGeocodeRequest(url.searchParams);
	if (!parsed.ok) {
		return json({ error: parsed.error }, { status: 400, headers: { 'cache-control': 'no-store' } });
	}

	const rate = await decideRate(request.headers, platform?.env);
	if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

	// Place-Details mode: resolve a Google placeId to exact coordinates server-side
	// (keeps the API key off the client and closes the autocomplete billing
	// session). This is what a picked Google suggestion calls instead of
	// re-text-searching its label — the fix for the wrong-place bug.
	if (parsed.value.mode === 'details') {
		const detail = await googlePlaceDetails(parsed.value.placeId, googlePlacesApiKey(), fetch, {
			sessionToken: parsed.value.sessionToken,
			languageCode: 'en',
		}).catch(() => null);
		if (!detail) {
			return json(
				{ error: 'not_found' },
				{ status: 404, headers: { 'cache-control': 'private, no-store' } },
			);
		}
		return json(detail, {
			headers: {
				'cache-control': 'private, max-age=0, no-store',
			},
		});
	}

	if (parsed.value.suggest) {
		const requestedLimit = Number(url.searchParams.get('limit') ?? 5);
		const limit = Number.isFinite(requestedLimit)
			? Math.min(Math.max(Math.trunc(requestedLimit), 1), 6)
			: 5;
		const googleResults = await googlePlacesAutocompleteSuggestions(
			parsed.value.query,
			googlePlacesApiKey(),
			fetch,
			{
				limit,
				sessionToken: parsed.value.sessionToken,
				languageCode: 'en',
			},
		).catch(() => []);
		if (googleResults.length > 0) {
			return json(
				{ results: googleResults, attribution: 'google' },
				{
					headers: {
						'cache-control': 'private, max-age=0, no-store',
					},
				},
			);
		}

		const results = await geocodeMontrealSuggestions(parsed.value.query, fetch, limit);
		return json(
			{ results },
			{
				headers: {
					'cache-control': 'private, no-store',
				},
			},
		);
	}

	const result = await geocodeMontreal(parsed.value.query, fetch);
	if (!result) {
		return json(
			{ error: 'not_found' },
			{ status: 404, headers: { 'cache-control': 'private, no-store' } },
		);
	}

	return json(result, {
		headers: {
			'cache-control': 'private, no-store',
		},
	});
};

function googlePlacesApiKey(): string | undefined {
	return env.GOOGLE_MAPS_API_KEY ?? env.GOOGLE_PLACES_API_KEY ?? env.GOOGLE_MAPS_PLATFORM_API_KEY;
}

function parseGeocodeRequest(searchParams: URLSearchParams): ParseResult {
	const queries = searchParams.getAll('q');
	const placeIds = searchParams.getAll('placeId');
	const hasExactlyOneQuery = queries.length === 1 && placeIds.length === 0;
	const hasExactlyOnePlaceId = placeIds.length === 1 && queries.length === 0;
	if (!hasExactlyOneQuery && !hasExactlyOnePlaceId) {
		return { ok: false, error: 'invalid_mode' };
	}

	const sessions = searchParams.getAll('session');
	if (sessions.length > 1) return { ok: false, error: 'invalid_session' };
	const sessionToken = sessions[0] ?? null;
	if (sessionToken != null && !isGooglePlacesSessionToken(sessionToken)) {
		return { ok: false, error: 'invalid_session' };
	}

	if (hasExactlyOnePlaceId) {
		const rawPlaceId = placeIds[0];
		const placeId = rawPlaceId.trim();
		if (
			!placeId ||
			codePointLength(rawPlaceId) > PLACE_ID_MAX_CODE_POINTS ||
			CONTROL_CHARACTER.test(rawPlaceId)
		) {
			return { ok: false, error: 'invalid_place_id' };
		}
		if (sessionToken == null) return { ok: false, error: 'invalid_session' };
		return { ok: true, value: { mode: 'details', placeId, sessionToken } };
	}

	const rawQuery = queries[0];
	const query = rawQuery.trim();
	if (
		!query ||
		codePointLength(rawQuery) > QUERY_MAX_CODE_POINTS ||
		CONTROL_CHARACTER.test(rawQuery)
	) {
		return { ok: false, error: 'invalid_query' };
	}
	const suggest = searchParams.get('suggest') === '1';
	if (suggest && sessionToken == null) return { ok: false, error: 'invalid_session' };
	return { ok: true, value: { mode: 'query', query, suggest, sessionToken } };
}

function codePointLength(value: string): number {
	return Array.from(value).length;
}

function hasSameOriginProvenance(headers: Headers, expectedOrigin: string): boolean {
	const originPresent = headers.has('origin');
	const refererPresent = headers.has('referer');
	const originMatches =
		!originPresent || exactOriginHeader(headers.get('origin') ?? '', expectedOrigin);
	const refererMatches =
		!refererPresent || refererOrigin(headers.get('referer') ?? '') === expectedOrigin;
	if (!originMatches || !refererMatches) return false;

	if (headers.has('sec-fetch-site')) {
		return headers.get('sec-fetch-site') === 'same-origin';
	}
	return originPresent || refererPresent;
}

function exactOriginHeader(raw: string, expectedOrigin: string): boolean {
	try {
		const parsed = new URL(raw);
		return raw === parsed.origin && parsed.origin === expectedOrigin;
	} catch {
		return false;
	}
}

function refererOrigin(raw: string): string | null {
	try {
		return new URL(raw).origin;
	} catch {
		return null;
	}
}

async function decideRate(
	headers: Headers,
	platformEnv: App.Platform['env'] | undefined,
): Promise<TokenBucketDecision> {
	const trustedIp = headers.get('cf-connecting-ip')?.trim() || null;
	const key = trustedIp ?? MISSING_IP_KEY;
	const nativeBinding = trustedIp
		? platformEnv?.GEOCODE_RATE_LIMITER
		: platformEnv?.GEOCODE_SHARED_RATE_LIMITER;

	// READY-TO-ENABLE SEAM: when both commented Wrangler bindings are positively
	// verified and enabled, their Cloudflare-managed, location-local fixed-window
	// decision replaces the isolate map. Binding faults fall back to the repo
	// bucket so the endpoint stays available.
	if (nativeBinding) {
		try {
			const decision = await nativeBinding.limit({ key });
			if (typeof decision.success === 'boolean') {
				return {
					allowed: decision.success,
					tokensRemaining: Number.NaN,
					retryAfterSeconds: decision.success ? 0 : NATIVE_RATE_WINDOW_SECONDS,
				};
			}
		} catch {
			// Fall through to the repo-local defense-in-depth bucket.
		}
	}

	return trustedIp ? trustedIpLimiter.take(key) : missingIpLimiter.take(key);
}

function rateLimited(retryAfterSeconds: number): Response {
	return json(
		{ error: 'rate_limited' },
		{
			status: 429,
			headers: {
				'retry-after': String(Math.max(1, Math.ceil(retryAfterSeconds))),
				'cache-control': 'no-store',
			},
		},
	);
}
