/**
 * Kit 3.1.1 resolves the first NDJSON line even for fixed application/json data.
 * Consume a clone first so a truncated fixed response fails before navigation
 * commits. Keep the original Response and leave deferred streams untouched.
 */
export function pageDataFetch(fetcher: typeof fetch, origin: string): typeof fetch {
	return async (input, init) => {
		const response = await fetcher(input, init);
		const url = new URL(input instanceof Request ? input.url : input, origin);
		if (
			url.origin === origin &&
			(url.pathname.endsWith('/__data.json') || url.pathname.endsWith('.html__data.json')) &&
			response.ok &&
			response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ===
				'application/json'
		) {
			await response.clone().json();
		}
		return response;
	};
}
