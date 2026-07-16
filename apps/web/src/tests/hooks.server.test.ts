import { describe, expect, it, vi } from 'vitest';
import { handle } from '../hooks.server';

describe('server request locale', () => {
	it('stores the path locale for error layouts that have no route params', async () => {
		const event = {
			url: new URL('https://transit.yesid.dev/fr/missing-route'),
			locals: {},
		} as Parameters<typeof handle>[0]['event'];
		const resolve = vi.fn(async () => new Response('ok'));

		await handle({ event, resolve });

		expect(event.locals.locale).toBe('fr');
		expect(event.locals.v1Cache).toBeInstanceOf(Map);
	});
});
