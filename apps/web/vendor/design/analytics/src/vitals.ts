export const VITALS_METRIC_NAMES = ['CLS', 'FCP', 'INP', 'LCP', 'TTFB'] as const;
export type VitalsMetricName = (typeof VITALS_METRIC_NAMES)[number];

export const VITALS_RATINGS = ['good', 'needs-improvement', 'poor'] as const;
export type VitalsRating = (typeof VITALS_RATINGS)[number];

export const VITALS_NAV_TYPES = [
	'navigate',
	'reload',
	'back-forward',
	'back-forward-cache',
	'prerender',
	'restore',
] as const;
export type VitalsNavType = (typeof VITALS_NAV_TYPES)[number];

export interface VitalsSample {
	readonly name: VitalsMetricName;
	readonly value: number;
	readonly id: string;
	readonly rating: VitalsRating;
	readonly navType: VitalsNavType;
	readonly path: string;
	readonly conn?: string;
}

export interface VitalsBeacon {
	readonly samples: readonly VitalsSample[];
}

export const MAX_VITALS_SAMPLES = 12;
export const MAX_VITALS_BODY_BYTES = 4096;
export const MAX_VITALS_PATH_LEN = 256;
export const MAX_VITALS_CONN_LEN = 32;

function isFiniteNumber(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown, max: number): v is string {
	return typeof v === 'string' && v.length > 0 && v.length <= max;
}

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

/** Valid samples of a beacon, or `null` when the beacon itself is malformed or oversized. */
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

export interface VitalsMetric {
	readonly name: VitalsMetricName;
	readonly value: number;
	readonly id: string;
	readonly rating: VitalsRating;
	readonly navigationType: VitalsNavType;
}

type VitalsReporter = (
	onReport: (metric: VitalsMetric) => void,
	opts?: { reportAllChanges?: boolean },
) => void;

/** The part of the `web-vitals` module the collector uses. */
export interface WebVitalsModule {
	readonly onCLS: VitalsReporter;
	readonly onFCP: VitalsReporter;
	readonly onINP: VitalsReporter;
	readonly onLCP: VitalsReporter;
	readonly onTTFB: VitalsReporter;
}

export interface StartVitalsOptions {
	/** Same-origin path that receives the JSON beacon. */
	readonly endpoint: string;
	/** Loads `web-vitals`, for example `() => import('web-vitals')`. */
	readonly load: () => Promise<WebVitalsModule>;
}

let started = false;

function connectionType(): string | undefined {
	const effective = (navigator as Navigator & { connection?: { effectiveType?: unknown } })
		.connection?.effectiveType;
	return typeof effective === 'string' && effective ? effective : undefined;
}

/**
 * Collects Core Web Vitals once per page load and sends them in one beacon when the page is
 * hidden. Browser only; a second call is a no-op. Never throws: RUM must not break the page.
 */
export function startVitals({ endpoint, load }: StartVitalsOptions): () => void {
	if (started || typeof window === 'undefined') return () => {};
	started = true;

	const buffer = new Map<string, VitalsSample>();
	let flushed = false;
	let dispose = () => {};

	const record = (metric: VitalsMetric) => {
		if (buffer.size >= MAX_VITALS_SAMPLES && !buffer.has(metric.id)) return;
		const conn = connectionType();
		buffer.set(metric.id, {
			name: metric.name,
			value: metric.value,
			id: metric.id,
			rating: metric.rating,
			navType: metric.navigationType,
			path: window.location.pathname || '/',
			...(conn ? { conn } : {}),
		});
	};

	const flush = () => {
		if (flushed || buffer.size === 0) return;
		flushed = true;
		const body = JSON.stringify({ samples: [...buffer.values()] } satisfies VitalsBeacon);

		try {
			const blob = new Blob([body], { type: 'application/json' });
			if (navigator.sendBeacon?.(endpoint, blob)) return;
		} catch {
			// Fall through to the keepalive fetch.
		}
		try {
			void fetch(endpoint, {
				method: 'POST',
				body,
				keepalive: true,
				headers: { 'content-type': 'application/json' },
			}).catch(() => {});
		} catch {
			// Give up silently.
		}
	};

	void Promise.resolve()
		.then(load)
		.then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
			const opts = { reportAllChanges: true };
			for (const report of [onCLS, onFCP, onINP, onLCP, onTTFB]) report(record, opts);

			const onVisibility = () => {
				if (document.visibilityState === 'hidden') flush();
			};
			document.addEventListener('visibilitychange', onVisibility);
			window.addEventListener('pagehide', flush);
			dispose = () => {
				document.removeEventListener('visibilitychange', onVisibility);
				window.removeEventListener('pagehide', flush);
			};
		})
		.catch(() => {});

	return () => dispose();
}
