import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import boot from '@yesid/ui/boot.json';
import { SECURITY_HEADERS } from '@yesid/seo-kit/headers';
import config, { cspDirectives } from '../../../svelte.config.js';
import { DOCUMENT_SECURITY_HEADERS } from './securityHeaders';

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

// SvelteKit's serialization: keywords are quoted, hosts and schemes are not.
function serialize(directives: object): string {
	return Object.entries(directives)
		.map(([name, sources]) =>
			[
				name,
				...(Array.isArray(sources)
					? sources.map((source: string) => (/^[a-z-]+$/.test(source) ? `'${source}'` : source))
					: []),
			].join(' '),
		)
		.join('; ');
}

describe('document security headers', () => {
	it('sends every package header, with geolocation allowed for the map', () => {
		for (const name of Object.keys(SECURITY_HEADERS)) {
			expect(DOCUMENT_SECURITY_HEADERS).toHaveProperty(name);
		}
		expect(DOCUMENT_SECURITY_HEADERS['Permissions-Policy']).toContain('geolocation=(self)');
	});

	it('omits Cross-Origin-Resource-Policy (it would break social OG scrapes)', () => {
		expect(DOCUMENT_SECURITY_HEADERS['Cross-Origin-Resource-Policy']).toBeUndefined();
	});
});

describe('content security policy', () => {
	it('allows inline scripts only by hash and lists the data, map and analytics origins', () => {
		const csp = config.kit?.csp;
		expect(csp?.mode).toBe('hash');
		expect(csp?.directives?.['script-src']).toEqual(['self', boot.hash]);
		expect(csp?.directives?.['connect-src']).toEqual([
			'self',
			'https://data.yesid.dev',
			'https://plausible.io',
			'https://protomaps.github.io',
		]);
		expect(csp?.directives?.['img-src']).toEqual([
			'self',
			'data:',
			'blob:',
			'https://protomaps.github.io',
			'https://transit.yesid.dev',
		]);
		expect(csp?.directives?.['worker-src']).toEqual(['self', 'blob:']);
	});
});

describe('drift gate — _headers /* block matches svelte.config.js and the document headers', () => {
	const fileHeaders = parseHeadersFileGlobBlock();

	it('asset CSP is the document policy without inline-script hashes', () => {
		expect(fileHeaders['content-security-policy']).toBe(serialize(cspDirectives()));
	});

	it('asset non-CSP headers equal the document headers', () => {
		for (const [name, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
			expect(fileHeaders[name.toLowerCase()], name).toBe(value);
		}
	});
});
