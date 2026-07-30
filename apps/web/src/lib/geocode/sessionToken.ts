export interface GoogleSessionTokenCrypto {
	randomUUID?(): string;
	getRandomValues?(bytes: Uint8Array): Uint8Array;
}

const GOOGLE_SESSION_TOKEN = /^[A-Za-z0-9_-]{1,36}$/;
const FALLBACK_RANDOM_BYTES = 18;
let fallbackSequence = 0;

export function isGooglePlacesSessionToken(token: string): boolean {
	return GOOGLE_SESSION_TOKEN.test(token);
}

export function createGooglePlacesSessionToken(
	crypto: GoogleSessionTokenCrypto | null = globalThis.crypto,
): string {
	const uuid = crypto?.randomUUID?.();
	if (uuid && isGooglePlacesSessionToken(uuid)) return uuid;

	if (crypto?.getRandomValues) {
		const bytes = crypto.getRandomValues(new Uint8Array(FALLBACK_RANDOM_BYTES));
		return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	}

	// Ancient/non-browser runtimes may expose neither crypto API. The monotonic
	// suffix keeps tokens distinct for this document while staying inside Google's
	// URL-safe, at-most-36-character contract.
	fallbackSequence += 1;
	return `fallback_${Date.now().toString(36)}_${fallbackSequence.toString(36)}`;
}
