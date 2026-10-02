import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { MAX_VITALS_SAMPLES, type VitalsBeacon, type VitalsSample } from './schema';

const BEACON_PATH = '/api/vitals';

let started = false;

export function vitalsEnabled(): boolean {
	return env.PUBLIC_VITALS_ENABLED === 'true';
}

function currentPath(): string {
	try {
		return window.location.pathname || '/';
	} catch {
		return '/';
	}
}

function connectionType(): string | undefined {
	const nav = navigator as Navigator & {
		connection?: { effectiveType?: string };
	};
	const effective = nav.connection?.effectiveType;
	return typeof effective === 'string' && effective ? effective : undefined;
}

export function startVitals(): () => void {
	const noop = () => {};
	if (!browser || started || !vitalsEnabled()) return noop;
	started = true;

	const buffer = new Map<string, VitalsSample>();
	let flushed = false;

	const record = (sample: VitalsSample) => {
		if (buffer.size >= MAX_VITALS_SAMPLES && !buffer.has(sample.id)) return;
		buffer.set(sample.id, sample);
	};

	const flush = () => {
		if (flushed) return;
		if (buffer.size === 0) return;
		flushed = true;

		const beacon: VitalsBeacon = { samples: [...buffer.values()] };
		const body = JSON.stringify(beacon);

		try {
			if (typeof navigator.sendBeacon === 'function') {
				const blob = new Blob([body], { type: 'application/json' });
				const ok = navigator.sendBeacon(BEACON_PATH, blob);
				if (ok) return;
			}
		} catch {
			// Fall through to the keepalive fetch.
		}

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
		.catch(() => {});

	return () => dispose();
}
