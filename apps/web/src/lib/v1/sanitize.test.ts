import { describe, expect, it } from 'vitest';
import { sanitizeAlertHtml, toAlertViewModel, type RawAlert } from './sanitize';

// The sanitizer is the app's single inline-markup affordance (agency alert copy)
// and therefore its biggest XSS surface. These tests pin the allowlist contract:
// only a[href]/b/strong/br survive, links are scheme-vetted + rel-forced, and the
// alert view-model never leaks the internal header_key/header_text tokens.

describe('sanitizeAlertHtml — link scheme allowlist', () => {
	it('keeps http/https links, forcing rel="noopener noreferrer"', () => {
		expect(sanitizeAlertHtml('<a href="https://stm.info/avis">avis</a>')).toBe(
			'<a href="https://stm.info/avis" rel="noopener noreferrer">avis</a>',
		);
		expect(sanitizeAlertHtml('<a href="http://stm.info/x">x</a>')).toBe(
			'<a href="http://stm.info/x" rel="noopener noreferrer">x</a>',
		);
	});

	it('keeps mailto + tel links', () => {
		expect(sanitizeAlertHtml('<a href="mailto:info@stm.info">mail</a>')).toBe(
			'<a href="mailto:info@stm.info" rel="noopener noreferrer">mail</a>',
		);
		expect(sanitizeAlertHtml('<a href="tel:+15145551234">call</a>')).toBe(
			'<a href="tel:+15145551234" rel="noopener noreferrer">call</a>',
		);
	});

	it('keeps root-relative, fragment, and query-only hrefs', () => {
		expect(sanitizeAlertHtml('<a href="/lines/747">747</a>')).toBe(
			'<a href="/lines/747" rel="noopener noreferrer">747</a>',
		);
		expect(sanitizeAlertHtml('<a href="#section">jump</a>')).toBe(
			'<a href="#section" rel="noopener noreferrer">jump</a>',
		);
		expect(sanitizeAlertHtml('<a href="?q=1">query</a>')).toBe(
			'<a href="?q=1" rel="noopener noreferrer">query</a>',
		);
	});

	it.each([
		['javascript:', '<a href="javascript:alert(1)">x</a>'],
		['data:', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
		['vbscript:', '<a href="vbscript:msgbox(1)">x</a>'],
		['file:', '<a href="file:///etc/passwd">x</a>'],
		['scheme-relative', '<a href="//evil.example/x">x</a>'],
		['bare relative', '<a href="foo/bar">x</a>'],
	])('drops the unsafe href (%s) while preserving the text + rel', (_label, input) => {
		const out = sanitizeAlertHtml(input);
		expect(out).not.toContain('href=');
		expect(out).toContain('rel="noopener noreferrer"');
		expect(out).toContain('x');
		// The dangerous scheme must not survive in any form.
		expect(out.toLowerCase()).not.toMatch(/javascript:|vbscript:|data:|file:/);
	});

	it('neutralizes a javascript: scheme hidden behind HTML entities', () => {
		// "javascript:" spelled with a numeric-entity "j" + an &colon; — a classic
		// entity-encoding bypass. normalizeForSchemeCheck must catch it.
		const out = sanitizeAlertHtml('<a href="&#106;avascript&colon;alert(1)">x</a>');
		expect(out).not.toContain('href=');
		expect(out.toLowerCase()).not.toContain('javascript');
		expect(out).toContain('rel="noopener noreferrer"');
	});

	it('neutralizes a javascript: scheme with embedded control whitespace', () => {
		const out = sanitizeAlertHtml('<a href="java\tscript:alert(1)">x</a>');
		expect(out).not.toContain('href=');
		expect(out).toContain('rel="noopener noreferrer"');
	});
});

describe('sanitizeAlertHtml — event handlers + disallowed tags', () => {
	it('strips on*-event handlers from allowed tags', () => {
		// b is allowed but takes NO attributes — onclick must vanish.
		expect(sanitizeAlertHtml('<b onclick="alert(1)">bold</b>')).toBe('<b>bold</b>');
		// onerror on an allowed link survives only as a bare scheme-vetted anchor.
		const out = sanitizeAlertHtml('<a href="https://x.test" onmouseover="steal()">y</a>');
		expect(out).not.toContain('onmouseover');
		expect(out).toBe('<a href="https://x.test" rel="noopener noreferrer">y</a>');
	});

	it('drops <script> and its contents entirely', () => {
		expect(sanitizeAlertHtml('before<script>alert(1)</script>after')).toBe('beforeafter');
	});

	it('drops <style> and its contents entirely', () => {
		expect(sanitizeAlertHtml('a<style>body{display:none}</style>b')).toBe('ab');
	});

	it('drops disallowed tags but keeps their text content (HTML-encoded)', () => {
		expect(sanitizeAlertHtml('<div><img src=x onerror=alert(1)>text</div>')).toBe('text');
		expect(sanitizeAlertHtml('<p>hello <em>world</em></p>')).toBe('hello world');
	});

	it('drops HTML comments so <!-- <script> --> cannot smuggle markup', () => {
		expect(sanitizeAlertHtml('a<!-- <script>alert(1)</script> -->b')).toBe('ab');
	});

	it('encodes a bare "<" and stray angle brackets as inert text', () => {
		expect(sanitizeAlertHtml('5 < 10 and 10 > 5')).toBe('5 &lt; 10 and 10 &gt; 5');
	});

	it('keeps b/strong/br while encoding adjacent dangerous text', () => {
		expect(sanitizeAlertHtml('<strong>Avis</strong><br><b>important</b>')).toBe(
			'<strong>Avis</strong><br /><b>important</b>',
		);
	});

	it('returns empty string for empty / non-string input', () => {
		expect(sanitizeAlertHtml('')).toBe('');
		// @ts-expect-error — exercising the runtime non-string guard.
		expect(sanitizeAlertHtml(null)).toBe('');
		// @ts-expect-error — exercising the runtime non-string guard.
		expect(sanitizeAlertHtml(undefined)).toBe('');
	});
});

describe('toAlertViewModel', () => {
	const base: RawAlert = {
		id: 'a1',
		severity: 'high',
		title_en: 'Line closed',
		title_fr: 'Ligne fermée',
		body_en_html: '<a href="https://stm.info">details</a>',
		body_fr_html: '<a href="https://stm.info">détails</a>',
		routes: ['747'],
		stops: ['STOP_1'],
	};

	it('picks the locale-correct copy and sanitizes the body', () => {
		const en = toAlertViewModel(base, 'en');
		expect(en.title).toBe('Line closed');
		expect(en.body).toBe('<a href="https://stm.info" rel="noopener noreferrer">details</a>');

		const fr = toAlertViewModel(base, 'fr');
		expect(fr.title).toBe('Ligne fermée');
		expect(fr.body).toBe('<a href="https://stm.info" rel="noopener noreferrer">détails</a>');
	});

	it('strips markup from the title (titles are plain text)', () => {
		const vm = toAlertViewModel({ ...base, title_en: '<b>Line</b> <em>closed</em>' }, 'en');
		expect(vm.title).toBe('Line closed');
		expect(vm.title).not.toContain('<');
		expect(vm.title).not.toContain('>');
	});

	it('decodes the basic entities the sanitizer emits in the title', () => {
		const vm = toAlertViewModel({ ...base, title_en: 'A &amp; B &lt;line&gt;' }, 'en');
		expect(vm.title).toBe('A & B <line>');
	});

	it('falls back to the other locale when the requested one is empty', () => {
		const vm = toAlertViewModel({ ...base, title_en: '', body_en_html: null }, 'en');
		expect(vm.title).toBe('Ligne fermée');
		expect(vm.body).toBe('<a href="https://stm.info" rel="noopener noreferrer">détails</a>');
	});

	it('defaults routes/stops to empty arrays when absent', () => {
		const vm = toAlertViewModel(
			{ id: 'a2', severity: 'watch', routes: null, stops: undefined },
			'en',
		);
		expect(vm.routes).toEqual([]);
		expect(vm.stops).toEqual([]);
	});

	it('NEVER surfaces the internal header_key / header_text tokens', () => {
		const vm = toAlertViewModel(
			{
				...base,
				header_key: 'AVIS_FR_RAW_TOKEN',
				header_text: 'texte brut FR interne',
			},
			'en',
		);
		const serialized = JSON.stringify(vm);
		expect(serialized).not.toContain('AVIS_FR_RAW_TOKEN');
		expect(serialized).not.toContain('texte brut FR interne');
		expect(vm).not.toHaveProperty('header_key');
		expect(vm).not.toHaveProperty('header_text');
	});

	it('never emits raw/unsanitized HTML in the body', () => {
		const vm = toAlertViewModel(
			{
				...base,
				body_en_html: '<img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>',
			},
			'en',
		);
		expect(vm.body).not.toContain('onerror');
		expect(vm.body).not.toContain('<img');
		expect(vm.body.toLowerCase()).not.toContain('javascript:');
	});
});
