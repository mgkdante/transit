// Best-effort collection: absent Analytics Engine bindings and write failures
// return 204. Only validated sample fields are stored; request headers are not.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAX_VITALS_BODY_BYTES, parseVitalsBeacon, type VitalsSample } from '$lib/vitals/schema';

export const prerender = false;

const NO_CONTENT = () => new Response(null, { status: 204 });

export const POST: RequestHandler = async ({ request, platform }) => {
	const declaredLen = Number(request.headers.get('content-length') ?? '');
	if (Number.isFinite(declaredLen) && declaredLen > MAX_VITALS_BODY_BYTES) {
		return json({ error: 'payload_too_large' }, { status: 413 });
	}

	// Enforce the body limit even when the declared length is absent or false.
	let raw: string;
	try {
		raw = await request.text();
	} catch {
		return json({ error: 'unreadable_body' }, { status: 400 });
	}
	if (raw.length > MAX_VITALS_BODY_BYTES) {
		return json({ error: 'payload_too_large' }, { status: 413 });
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return json({ error: 'invalid_json' }, { status: 400 });
	}

	// Invalid envelopes fail; a valid envelope with no valid samples is a no-op.
	const samples = parseVitalsBeacon(parsed);
	if (samples === null) {
		return json({ error: 'invalid_shape' }, { status: 400 });
	}
	if (samples.length === 0) return NO_CONTENT();

	const dataset = platform?.env?.WEB_VITALS;
	if (!dataset) return NO_CONTENT();

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
