/** Headers every yesid product sends on documents and assets. The product adds its own CSP. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'X-Frame-Options': 'DENY',
	'Cross-Origin-Opener-Policy': 'same-origin',
	// No browsing-topics or interest-cohort: browsers log them as unrecognised features.
	'Permissions-Policy':
		'accelerometer=(), bluetooth=(), camera=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), payment=(), serial=(), usb=()',
};

/** A directive without sources, such as `upgrade-insecure-requests`, is written on its own. */
export function contentSecurityPolicy(directives: Readonly<Record<string, readonly string[]>>): string {
	return Object.entries(directives)
		.map(([name, sources]) => [name, ...sources].join(' '))
		.join('; ');
}
