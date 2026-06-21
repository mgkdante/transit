// Web-Vitals RUM beacon endpoint (slice-9.7 item D) — INERT BY DEFAULT.
//
// The browser collector ($lib/vitals/collect.ts) POSTs a batch of Core-Web-
// Vitals samples here on page-hide. This handler:
//   1. VALIDATES the body — rejects non-JSON, oversized payloads, and malformed
//      shapes WITHOUT ever throwing to a 500 (a beacon must be harmless).
//   2. If the Analytics Engine binding `platform.env.WEB_VITALS` EXISTS, writes
//      one data point per sample.
//   3. If the binding is ABSENT (the default — it ships COMMENTED in
//      wrangler.toml), it NO-OPS and returns 204. So merging this endpoint
//      changes nothing in production until the operator wires the dataset.
//
// PRIVACY: we persist only the non-identifying fields the schema admits — metric
// name / rating / pathname / navigationType (blobs) and the numeric value
// (doubles). No headers, no IPs, no identifiers. Path is already query-stripped
// at the source and re-validated here.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAX_VITALS_BODY_BYTES, parseVitalsBeacon, type VitalsSample } from '$lib/vitals/schema';

export const prerender = false;

/** 204 No Content — the beacon's success (and harmless-no-op) response. */
const NO_CONTENT = () => new Response(null, { status: 204 });

export const POST: RequestHandler = async ({ request, platform }) => {
	// --- Cheap size guard BEFORE reading the body: reject oversized declared len.
	const declaredLen = Number(request.headers.get('content-length') ?? '');
	if (Number.isFinite(declaredLen) && declaredLen > MAX_VITALS_BODY_BYTES) {
		return json({ error: 'payload_too_large' }, { status: 413 });
	}

	// --- Read raw text, then enforce the real byte cap (content-length can lie).
	let raw: string;
	try {
		raw = await request.text();
	} catch {
		return json({ error: 'unreadable_body' }, { status: 400 });
	}
	if (raw.length > MAX_VITALS_BODY_BYTES) {
		return json({ error: 'payload_too_large' }, { status: 413 });
	}

	// --- Parse JSON. Bad JSON is a 400, never a 500.
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}

	// --- Validate the envelope. A malformed envelope (not {samples:[...]}) is a
	//     400; an envelope with only malformed samples yields an empty list, which
	//     we treat as a quiet 204 no-op (nothing to record, but not an error).
	const samples = parseVitalsBeacon(parsed);
	if (samples === null) {
		return json({ error: 'invalid_shape' }, { status: 400 });
	}
	if (samples.length === 0) return NO_CONTENT();

	// --- No binding wired (the default): quiet no-op. NEVER error on absence.
	const dataset = platform?.env?.WEB_VITALS;
	if (!dataset) return NO_CONTENT();

	// --- Write one Analytics Engine data point per sample. A binding failure must
	//     not surface to the client (the page is already unloading); swallow it.
	try {
		for (const sample of samples) {
			dataset.writeDataPoint(toDataPoint(sample));
		}
	} catch {
		// Analytics Engine write failed — RUM is best-effort; still 204.
	}

	return NO_CONTENT();
};

/**
 * Analytics Engine schema for one sample:
 *   indexes: [metric name]                          (sampling/grouping key)
 *   blobs:   [name, rating, path, navType, conn]    (dimensions)
 *   doubles: [value]                                (the measurement)
 */
function toDataPoint(sample: VitalsSample): {
	indexes: string[];
	blobs: (string | null)[];
	doubles: number[];
} {
	return {
		indexes: [sample.name],
		blobs: [sample.name, sample.rating, sample.path, sample.navType, sample.conn ?? null],
		doubles: [sample.value],
	};
}
