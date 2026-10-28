import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { securityHeaders, contentSecurityPolicyFor } from './securityHeaders';
import { SECURITY_HEADERS } from '@yesid/seo-kit/headers';

function parseHeadersFileGlobBlock(): Record<string, string> {
	const text = readFileSync(resolve(process.cwd(), '_headers'), 'utf-8');
	const lines = text.split('\n');
	const out: Record<string, string> = {};
	let inGlob = false;
	for (const line of lines) {
		if (line.startsWith('#')) continue;
		if (/^\S/.test(line)) {
			inGlob = line.trim() === '/*';
			continue;
		}
		if (!inGlob) continue;
		const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
		if (m) out[m[1].toLowerCase()] = m[2].trim();
	}
	return out;
}

describe('securityHeaders — production set', () => {
	const headers = securityHeaders({ dev: false });

	it('ships every package security header', () => {
		for (const name of Object.keys(SECURITY_HEADERS)) expect(headers).toHaveProperty(name);
	});

	it('sets the expected non-CSP values', () => {
		expect(headers['X-Frame-Options']).toBe('DENY');
	});

	it('keeps geolocation enabled (near-me) but denies the unused powerful features', () => {
		const pp = headers['Permissions-Policy'];
		expect(pp).toContain('geolocation=(self)');
		for (const feature of [
			'accelerometer',
			'bluetooth',
			'camera',
			'gyroscope',
			'hid',
			'magnetometer',
			'microphone',
			'payment',
			'serial',
			'usb',
		]) {
			expect(pp).toContain(`${feature}=()`);
		}
	});

	it('drops browsing-topics + interest-cohort (browsers log them as unrecognised)', () => {
		const pp = headers['Permissions-Policy'];
		expect(pp).not.toContain('browsing-topics');
		expect(pp).not.toContain('interest-cohort');
	});

	it('omits Cross-Origin-Resource-Policy (it would break social OG scrapes)', () => {
		expect(headers['Cross-Origin-Resource-Policy']).toBeUndefined();
	});
});

describe('contentSecurityPolicy — invariants', () => {
	const csp = contentSecurityPolicyFor({ dev: false });

	it('allows the basemap glyph host and the direct R2 /v1 origin', () => {
		expect(csp).toContain('https://protomaps.github.io');
		expect(csp).toContain('https://data.yesid.dev');
	});

	it('allows Cloudflare Web Analytics beacon in script-src', () => {
		expect(csp).toMatch(/script-src[^;]*https:\/\/static\.cloudflareinsights\.com/);
	});

	it('allows blob workers (pmtiles/maplibre) and locks framing/objects down', () => {
		expect(csp).toContain("worker-src 'self' blob:");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("object-src 'none'");
		expect(csp).toContain('upgrade-insecure-requests');
	});

	it('keeps the quota-bearing transit data proxy out of connect-src', () => {
		expect(csp).not.toMatch(/connect-src[^;]*https:\/\/transit\.yesid\.dev/);
	});

	it('narrows img-src off the broad https: wildcard, keeping the basemap + OG hosts', () => {
		expect(csp).toContain(
			"img-src 'self' data: blob: https://protomaps.github.io https://transit.yesid.dev",
		);
		expect(csp).not.toMatch(/img-src[^;]*\bhttps:(?!\/\/)/);
	});
});

describe('devContentSecurityPolicy — local HMR relaxations only', () => {
	it('adds the vite websocket + eval over the prod base, nothing tighter', () => {
		const dev = contentSecurityPolicyFor({ dev: true });
		expect(dev).toContain('ws:');
		expect(dev).toContain("'unsafe-eval'");
		expect(dev).toContain('https://protomaps.github.io');
		expect(dev).toContain("frame-ancestors 'none'");
	});
});

describe('drift gate — _headers /* block matches the TS source of truth', () => {
	const fileHeaders = parseHeadersFileGlobBlock();

	it('asset CSP equals the production document CSP', () => {
		expect(fileHeaders['content-security-policy']).toBe(contentSecurityPolicyFor({ dev: false }));
	});

	it('asset non-CSP headers equal the production document headers', () => {
		const prod = securityHeaders({ dev: false });
		expect(fileHeaders['x-content-type-options']).toBe(prod['X-Content-Type-Options']);
		expect(fileHeaders['x-frame-options']).toBe(prod['X-Frame-Options']);
		expect(fileHeaders['referrer-policy']).toBe(prod['Referrer-Policy']);
		expect(fileHeaders['strict-transport-security']).toBe(prod['Strict-Transport-Security']);
		expect(fileHeaders['permissions-policy']).toBe(prod['Permissions-Policy']);
		expect(fileHeaders['cross-origin-opener-policy']).toBe(prod['Cross-Origin-Opener-Policy']);
	});
});
