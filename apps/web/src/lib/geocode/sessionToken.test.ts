import { describe, expect, it, vi } from 'vitest';
import { createGooglePlacesSessionToken, isGooglePlacesSessionToken } from './sessionToken';

describe('Google Places session tokens', () => {
	it('keeps a valid random UUID from the browser crypto API', () => {
		const randomUUID = vi.fn(() => '123e4567-e89b-12d3-a456-426614174000');

		expect(createGooglePlacesSessionToken({ randomUUID })).toBe(
			'123e4567-e89b-12d3-a456-426614174000',
		);
	});

	it('falls back to 18 random bytes encoded as a 36-character URL-safe token', () => {
		const getRandomValues = vi.fn((bytes: Uint8Array) => {
			for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
			return bytes;
		});

		const token = createGooglePlacesSessionToken({ getRandomValues });

		expect(token).toBe('000102030405060708090a0b0c0d0e0f1011');
		expect(isGooglePlacesSessionToken(token)).toBe(true);
	});

	it('still emits distinct valid tokens when no crypto API is exposed', () => {
		vi.spyOn(Date, 'now').mockReturnValue(1_753_900_000_000);

		const first = createGooglePlacesSessionToken(null);
		const second = createGooglePlacesSessionToken(null);

		expect(first).not.toBe(second);
		expect(isGooglePlacesSessionToken(first)).toBe(true);
		expect(isGooglePlacesSessionToken(second)).toBe(true);
	});

	it.each([
		['', false],
		['a', true],
		['a'.repeat(36), true],
		['a'.repeat(37), false],
		['session_token-1', true],
		['session.token', false],
		['é', false],
	])('validates the Google URL-safe, at-most-36-character contract for %j', (token, valid) => {
		expect(isGooglePlacesSessionToken(token)).toBe(valid);
	});
});
