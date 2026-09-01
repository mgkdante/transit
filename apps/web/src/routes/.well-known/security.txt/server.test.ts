import { describe, expect, it } from 'vitest';
import { GET, prerender } from './+server';

describe('/.well-known/security.txt', () => {
	it('publishes the public vulnerability-reporting contract', async () => {
		const response = GET({} as Parameters<typeof GET>[0]);
		const body = await response.text();

		expect(prerender).toBe(true);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		expect(body).toBe(`Contact: https://github.com/mgkdante/transit/security/advisories/new
Contact: mailto:contact@yesid.dev
Expires: 2027-08-31T23:59:59Z
Preferred-Languages: en, fr
Canonical: https://transit.yesid.dev/.well-known/security.txt
Policy: https://github.com/mgkdante/transit/security/policy
`);
		expect(new Date('2027-08-31T23:59:59Z').getTime()).toBeGreaterThan(Date.now());
	});
});
