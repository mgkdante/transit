// Shared wire schema for the Web-Vitals RUM beacon (slice-9.7 item D).
//
// One place defines the payload the browser collector POSTs to /api/vitals and
// the endpoint validates against — so the two never drift. Kept dependency-free
// (no Zod) so the collector stays in the browser bundle with zero extra weight.
//
// PRIVACY DOCTRINE: every field here is non-identifying. `path` is a PATHNAME
// ONLY (query strings + hashes stripped at the source); there are NO user ids,
// no full URLs, no cookies, no IPs. The endpoint never reads request headers
// for identity. This shape is the contract that keeps it that way.

/** The five Core-Web-Vitals metric names we collect (web-vitals onCLS/…/onTTFB). */
export const VITALS_METRIC_NAMES = ['CLS', 'FCP', 'INP', 'LCP', 'TTFB'] as const;
export type VitalsMetricName = (typeof VITALS_METRIC_NAMES)[number];

/** web-vitals rating buckets. */
export const VITALS_RATINGS = ['good', 'needs-improvement', 'poor'] as const;
export type VitalsRating = (typeof VITALS_RATINGS)[number];

/** web-vitals navigationType values. */
export const VITALS_NAV_TYPES = [
	'navigate',
	'reload',
	'back-forward',
	'back-forward-cache',
	'prerender',
	'restore',
] as const;
export type VitalsNavType = (typeof VITALS_NAV_TYPES)[number];

/** One metric sample on the wire. Minimal, non-identifying context only. */
export interface VitalsSample {
	/** Metric acronym (CLS/FCP/INP/LCP/TTFB). */
	readonly name: VitalsMetricName;
	/** The metric value (ms for timing metrics; unitless for CLS). */
	readonly value: number;
	/** web-vitals per-instance id (dedupe key; NOT a user identifier). */
	readonly id: string;
	/** good / needs-improvement / poor. */
	readonly rating: VitalsRating;
	/** Navigation type that produced the sample. */
	readonly navType: VitalsNavType;
	/** PATHNAME ONLY (no query/hash) of the page the sample was measured on. */
	readonly path: string;
	/** Coarse effectiveType from the Network Information API, when available. */
	readonly conn?: string;
}

/** The beacon body: a batch of samples flushed together in ONE request. */
export interface VitalsBeacon {
	readonly samples: readonly VitalsSample[];
}

/** Hard cap on samples per beacon (5 metrics + a little slack for INP re-reports). */
export const MAX_VITALS_SAMPLES = 12;

/** Hard cap on the raw beacon body in bytes (anything larger is rejected). */
export const MAX_VITALS_BODY_BYTES = 4096;

/** Defensive cap on the path length we keep / store. */
export const MAX_VITALS_PATH_LEN = 256;

/** Defensive cap on the connection-type string we keep / store. */
export const MAX_VITALS_CONN_LEN = 32;

function isFiniteNumber(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown, max: number): v is string {
	return typeof v === 'string' && v.length > 0 && v.length <= max;
}

/**
 * Validate + normalize ONE sample from untrusted JSON. Returns a clean
 * VitalsSample or null when the shape is invalid (the caller drops nulls).
 * Never throws.
 */
export function parseVitalsSample(input: unknown): VitalsSample | null {
	if (!input || typeof input !== 'object') return null;
	const o = input as Record<string, unknown>;

	if (!VITALS_METRIC_NAMES.includes(o.name as VitalsMetricName)) return null;
	if (!isFiniteNumber(o.value) || o.value < 0) return null;
	if (!isNonEmptyString(o.id, 128)) return null;
	if (!VITALS_RATINGS.includes(o.rating as VitalsRating)) return null;
	if (!VITALS_NAV_TYPES.includes(o.navType as VitalsNavType)) return null;
	if (!isNonEmptyString(o.path, MAX_VITALS_PATH_LEN)) return null;
	if (!o.path.startsWith('/')) return null;

	const conn = isNonEmptyString(o.conn, MAX_VITALS_CONN_LEN) ? o.conn : undefined;

	return {
		name: o.name as VitalsMetricName,
		value: o.value,
		id: o.id,
		rating: o.rating as VitalsRating,
		navType: o.navType as VitalsNavType,
		path: o.path,
		...(conn ? { conn } : {}),
	};
}

/**
 * Validate the full beacon body. Returns the clean list of samples (possibly
 * empty after dropping malformed ones) or null when the envelope itself is
 * malformed (not an object, missing/oversized samples array). Never throws.
 */
export function parseVitalsBeacon(input: unknown): VitalsSample[] | null {
	if (!input || typeof input !== 'object') return null;
	const o = input as Record<string, unknown>;
	if (!Array.isArray(o.samples)) return null;
	if (o.samples.length === 0 || o.samples.length > MAX_VITALS_SAMPLES) return null;

	const out: VitalsSample[] = [];
	for (const raw of o.samples) {
		const sample = parseVitalsSample(raw);
		if (sample) out.push(sample);
	}
	return out;
}
