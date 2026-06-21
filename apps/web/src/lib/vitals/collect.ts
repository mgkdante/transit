// Web-Vitals RUM collector (slice-9.7 item D) — BROWSER-ONLY, INERT BY DEFAULT.
//
// THE INERT CONTRACT (the single most important property of this feature):
//   * Gated on PUBLIC_VITALS_ENABLED. Unless it is EXACTLY the string 'true',
//     startVitals() returns immediately — it imports nothing from web-vitals,
//     registers no listeners, opens no network. Merging this code changes
//     NOTHING in production until the operator flips the flag (see wrangler.toml).
//   * web-vitals is loaded with a DYNAMIC import INSIDE the enabled branch, so
//     the library is not even pulled into the critical path when the flag is off.
//
// PRIVACY DOCTRINE: we send a PATHNAME only (query string + hash stripped), the
// metric name/value/id/rating/navigationType, and a coarse connection type when
// the browser exposes one. NO full URLs, NO query params, NO user identifiers,
// NO cookies. See $lib/vitals/schema.ts for the exact wire shape.
//
// FLUSH MODEL (the web-vitals recommended pattern): each onX handler buffers its
// sample; we flush the WHOLE buffer in ONE beacon on the first of
// visibilitychange->hidden / pagehide, using navigator.sendBeacon (a keepalive
// fetch fallback when sendBeacon is missing). Batched — never one request per
// metric.

import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { MAX_VITALS_SAMPLES, type VitalsBeacon, type VitalsSample } from './schema';

const BEACON_PATH = '/api/vitals';

/** Idempotency guard — startVitals() wires the listeners at most once per page. */
let started = false;

/** True only when the PUBLIC flag is EXACTLY 'true'. Anything else = inert. */
export function vitalsEnabled(): boolean {
	return env.PUBLIC_VITALS_ENABLED === 'true';
}

/** Pathname only — strips query string + hash so no params/PII ever leave. */
function currentPath(): string {
	try {
		return window.location.pathname || '/';
	} catch {
		return '/';
	}
}

/** Coarse connection type (e.g. '4g'), when the Network Information API exists. */
function connectionType(): string | undefined {
	const nav = navigator as Navigator & {
		connection?: { effectiveType?: string };
	};
	const effective = nav.connection?.effectiveType;
	return typeof effective === 'string' && effective ? effective : undefined;
}

/**
 * Start the collector. No-op (returns a no-op disposer) unless we are in the
 * browser AND PUBLIC_VITALS_ENABLED === 'true'. Safe to call from onMount.
 */
export function startVitals(): () => void {
	const noop = () => {};
	if (!browser || started || !vitalsEnabled()) return noop;
	started = true;

	const buffer = new Map<string, VitalsSample>();
	let flushed = false;

	const record = (sample: VitalsSample) => {
		// Key by the web-vitals instance id so a re-reported metric (e.g. INP
		// updating before flush) overwrites rather than duplicates. Bounded.
		if (buffer.size >= MAX_VITALS_SAMPLES && !buffer.has(sample.id)) return;
		buffer.set(sample.id, sample);
	};

	const flush = () => {
		if (flushed) return;
		if (buffer.size === 0) return;
		flushed = true; // single-shot: the page is going away

		const beacon: VitalsBeacon = { samples: [...buffer.values()] };
		const body = JSON.stringify(beacon);

		try {
			if (typeof navigator.sendBeacon === 'function') {
				const blob = new Blob([body], { type: 'application/json' });
				const ok = navigator.sendBeacon(BEACON_PATH, blob);
				if (ok) return;
			}
		} catch {
			// fall through to the keepalive fetch
		}

		// Fallback: keepalive fetch survives the unload the same way sendBeacon does.
		try {
			void fetch(BEACON_PATH, {
				method: 'POST',
				body,
				keepalive: true,
				headers: { 'content-type': 'application/json' },
			}).catch(() => {});
		} catch {
			// give up silently — RUM must never break the page
		}
	};

	let dispose = noop;

	// Dynamic import so web-vitals is NOT bundled into the hot path when the flag
	// is off (the early return above already prevents this call when disabled).
	void import('web-vitals')
		.then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
			const toSample = (metric: {
				name: VitalsSample['name'];
				value: number;
				id: string;
				rating: VitalsSample['rating'];
				navigationType: VitalsSample['navType'];
			}): VitalsSample => {
				const conn = connectionType();
				return {
					name: metric.name,
					value: metric.value,
					id: metric.id,
					rating: metric.rating,
					navType: metric.navigationType,
					path: currentPath(),
					...(conn ? { conn } : {}),
				};
			};

			// reportAllChanges:true so the latest value is buffered before unload.
			const opts = { reportAllChanges: true };
			onCLS((m) => record(toSample(m)), opts);
			onFCP((m) => record(toSample(m)), opts);
			onINP((m) => record(toSample(m)), opts);
			onLCP((m) => record(toSample(m)), opts);
			onTTFB((m) => record(toSample(m)), opts);

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
		.catch(() => {
			// web-vitals failed to load — stay inert, never throw.
		});

	// The disposer detaches whatever got wired (a no-op if the import is still
	// in flight or failed). startVitals stays single-shot regardless.
	return () => dispose();
}
