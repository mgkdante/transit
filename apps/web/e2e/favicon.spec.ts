import { expect, test } from '@playwright/test';

// Icon services (and Plausible, through them) read only /favicon.ico, not the SVG link.
test('the root favicon.ico holds the brand mark at 16, 32 and 48 pixels', async ({ request }) => {
	const icon = await request.get('/favicon.ico');
	expect(icon.status()).toBe(200);
	const bytes = await icon.body();
	expect([bytes.readUInt16LE(0), bytes.readUInt16LE(2)], 'an ICO header').toEqual([0, 1]);
	const sizes = Array.from({ length: bytes.readUInt16LE(4) }, (_, i) => bytes[6 + i * 16] || 256);
	expect(sizes).toEqual([16, 32, 48]);
});
