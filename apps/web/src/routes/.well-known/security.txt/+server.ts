import type { RequestHandler } from './$types';

const SECURITY_TXT = `Contact: https://github.com/mgkdante/transit/security/advisories/new
Contact: mailto:contact@yesid.dev
Expires: 2027-08-31T23:59:59Z
Preferred-Languages: en, fr
Canonical: https://transit.yesid.dev/.well-known/security.txt
Policy: https://github.com/mgkdante/transit/security/policy
`;

export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(SECURITY_TXT, {
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	});
