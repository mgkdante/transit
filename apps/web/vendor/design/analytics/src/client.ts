import type { AnalyticsPreset } from './config';
import type { PlausibleEventPayload, PlausibleTransport } from './plausible';

const ACQUISITION_KEYS = [
	'utm_source',
	'utm_medium',
	'utm_campaign',
	'utm_content',
	'utm_term',
	'ref',
	'source',
] as const;

const SAFE_ACQUISITION_VALUE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function isSafeAcquisitionValue(value: string): boolean {
	return SAFE_ACQUISITION_VALUE.test(value) && value.replace(/\D/g, '').length < 7;
}

export interface AnalyticsClientDependencies {
	loadTransport(): Promise<PlausibleTransport>;
	canTrack(): boolean;
	getReferrer(): string;
}

export interface AnalyticsClient<EventName extends string> {
	trackPageview(url: URL): Promise<boolean>;
	trackEvent(name: EventName, url: URL): Promise<void>;
}

export function sanitizeAnalyticsUrl(url: URL): string {
	const sanitized = new URL(url.pathname, url.origin);

	for (const key of ACQUISITION_KEYS) {
		for (const value of url.searchParams.getAll(key)) {
			if (isSafeAcquisitionValue(value)) sanitized.searchParams.append(key, value);
		}
	}

	return sanitized.toString();
}

export function sanitizeAnalyticsReferrer(value: string): string | undefined {
	if (value === '') return undefined;
	try {
		const referrer = new URL(value);
		if (referrer.protocol !== 'http:' && referrer.protocol !== 'https:') {
			return undefined;
		}
		return `${referrer.origin}/`;
	} catch {
		return undefined;
	}
}

export function createPathnamePageviewTracker(
	send: (url: URL) => boolean | Promise<boolean>,
): (url: URL) => Promise<boolean> {
	let lastPathname: string | undefined;
	let queue: Promise<void> | undefined;

	return (url) => {
		const sendPageview = async () => {
			if (url.pathname === lastPathname) return false;

			const sent = await send(url);
			if (sent) lastPathname = url.pathname;
			return sent;
		};
		const request = queue ? queue.then(sendPageview) : sendPageview();
		const settled = request.then(
			() => undefined,
			() => undefined,
		);
		queue = settled;
		void settled.then(() => {
			if (queue === settled) queue = undefined;
		});
		return request;
	};
}

export function createAnalyticsClient<const EventName extends string>(
	preset: AnalyticsPreset<EventName>,
	dependencies: AnalyticsClientDependencies,
): AnalyticsClient<EventName> {
	let transportPromise: Promise<PlausibleTransport | null> | undefined;

	function isEnabled(url: URL): boolean {
		if (url.hostname !== preset.domain) return false;
		try {
			return dependencies.canTrack();
		} catch {
			return false;
		}
	}

	function load(): Promise<PlausibleTransport | null> {
		transportPromise ??= (async () => {
			try {
				return await dependencies.loadTransport();
			} catch {
				return null;
			}
		})();

		return transportPromise;
	}

	function referrer(): string | undefined {
		try {
			return sanitizeAnalyticsReferrer(dependencies.getReferrer());
		} catch {
			return undefined;
		}
	}

	async function send(
		name: 'pageview' | EventName,
		url: URL,
	): Promise<boolean> {
		if (!isEnabled(url)) return false;

		const transport = await load();
		if (!transport || !isEnabled(url)) return false;

		try {
			const payload: PlausibleEventPayload = {
				name,
				url: sanitizeAnalyticsUrl(url),
				domain: preset.domain,
			};
			const safeReferrer = referrer();
			if (safeReferrer) payload.referrer = safeReferrer;
			return await transport.sendPlausibleEvent(payload);
		} catch {
			return false;
		}
	}

	const trackPathname = createPathnamePageviewTracker((url) => send('pageview', url));

	return {
		async trackPageview(url): Promise<boolean> {
			if (!isEnabled(url)) return false;
			return trackPathname(url);
		},
		async trackEvent(name, url): Promise<void> {
			await send(name, url);
		},
	};
}
