export const PLAUSIBLE_ENDPOINT = 'https://plausible.io/api/event';
export const PLAUSIBLE_REQUEST_TIMEOUT_MS = 3_000;

export interface PlausibleEventPayload {
	name: string;
	url: string;
	domain: string;
	referrer?: string;
}

export interface PlausibleTransport {
	sendPlausibleEvent(payload: PlausibleEventPayload): Promise<boolean>;
}

export type PlausibleFetch = (
	input: string,
	init: RequestInit,
) => Promise<Response>;

export async function sendPlausibleEvent(
	payload: PlausibleEventPayload,
	fetcher: PlausibleFetch = fetch,
	timeoutMs = PLAUSIBLE_REQUEST_TIMEOUT_MS,
): Promise<boolean> {
	const controller = new AbortController();
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeout = new Promise<null>((resolve) => {
			timeoutId = setTimeout(() => {
				controller.abort();
				resolve(null);
			}, timeoutMs);
		});
		const response = await Promise.race([
			fetcher(PLAUSIBLE_ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: JSON.stringify(payload),
				keepalive: true,
				credentials: 'omit',
				signal: controller.signal,
			}),
			timeout,
		]);
		return response?.ok ?? false;
	} catch {
		return false;
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	}
}
