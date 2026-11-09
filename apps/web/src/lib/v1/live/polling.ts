/** Schedule just after cache expiry. Unexposed/malformed metadata uses the manifest TTL. */
export function livePollDelayMs(
	headers: Headers,
	ttlMs: number,
	random: () => number = Math.random,
): number {
	const match = /(?:^|,)\s*max-age\s*=\s*"?([0-9]+)"?\s*(?:,|$)/i.exec(
		headers.get('cache-control') ?? '',
	);
	const age = headers.get('age');
	if (!match || age === null || !/^\d+$/.test(age.trim())) return ttlMs;
	const remainingMs = (Number(match[1]) - Number(age)) * 1000;
	const jitterMs = 500 + Math.max(0, Math.min(1, random())) * 1500;
	return Math.min(ttlMs, Math.max(5000, remainingMs + jitterMs));
}
