import { expect, it } from 'vitest';
import { GET } from '../../routes/manifest.webmanifest/+server';

it('installs with a provider-neutral name in either locale', async () => {
	const response = GET({} as Parameters<typeof GET>[0]);
	const manifest = await (await response).json();
	expect(manifest.name).toBe('Transit');
	expect(manifest.short_name).toBe('Transit');
	expect(manifest.description).not.toMatch(/STM|Montréal/);
});
