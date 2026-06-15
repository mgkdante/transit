/**
 * Alert HTML sanitizer + alert view-model (XSS guard).
 *
 * Alerts are the ONE place rider-facing copy may carry inline markup (a few
 * service-advisory links / bold runs that the agency authors). Everything else
 * in the app is plain text. That single affordance is also the app's biggest
 * injection surface, so the rule here is deliberately strict and self-contained:
 *
 *   - A minimal ALLOWLIST sanitizer — `a[href]`, `b`, `strong`, `br` ONLY.
 *     Every other tag, attribute, comment, and `on*` handler is dropped.
 *   - It is pure, string-side, and SSR-safe: it NEVER touches `document` /
 *     `DOMParser` / the DOM, so it runs identically on the Cloudflare edge
 *     (SSR) and in the browser. No DOMPurify dependency.
 *   - Links are forced to `rel="noopener noreferrer"` and only safe URL schemes
 *     survive (`http`, `https`, `mailto`, `tel`, and root-relative `/…`).
 *
 * The view-model (`toAlertViewModel`) picks the locale-correct copy and, by
 * construction, NEVER surfaces `header_key` — that field is an internal
 * label-resolution token (raw FR), not rider copy, and must not be rendered or
 * passed to `resolveLabel`.
 */

import type { Locale } from '$lib/i18n';
import type { SeverityCode } from '$lib/v1/schemas';

// ---------------------------------------------------------------------------
// HTML sanitizer
// ---------------------------------------------------------------------------

/** Tags that survive sanitization. Everything else is stripped to its text. */
const ALLOWED_TAGS: ReadonlySet<string> = new Set(['a', 'b', 'strong', 'br']);

/**
 * Void (self-closing) allowed tags — emitted without a closing tag. `br` is the
 * only void tag in the allowlist.
 */
const VOID_TAGS: ReadonlySet<string> = new Set(['br']);

/**
 * URL schemes permitted on `<a href>`. Anything else (notably `javascript:`,
 * `data:`, `vbscript:`, `file:`) is rejected and the link is dropped to its
 * text content. Scheme-relative (`//evil`) is also rejected.
 */
const SAFE_URL_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Forced rel value on every surviving link — defeats tab-nabbing + referrer leak. */
const FORCED_REL = 'noopener noreferrer';

/**
 * Decode the handful of HTML entities that can hide a dangerous scheme, plus
 * strip control / zero-width characters and whitespace that browsers tolerate
 * inside a scheme (e.g. `java\tscript:`). Used ONLY to vet an href before we
 * decide to keep it — the value we actually emit is re-encoded separately.
 */
function normalizeForSchemeCheck(value: string): string {
	return (
		value
			// Numeric + named entities that could spell out "javascript" etc.
			.replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => safeFromCodePoint(parseInt(hex, 16)))
			.replace(/&#(\d+);?/g, (_m, dec) => safeFromCodePoint(parseInt(dec, 10)))
			.replace(/&colon;/gi, ':')
			.replace(/&tab;/gi, '\t')
			.replace(/&newline;/gi, '\n')
			// Control chars (incl. tab/newline), zero-width space/joiner/
			// non-joiner, and the BOM — browsers tolerate these in a scheme.
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u0020\u200b-\u200d\ufeff]/g, '')
	);
}

/** `String.fromCodePoint` that never throws on a bogus/out-of-range value. */
function safeFromCodePoint(code: number): string {
	if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
	try {
		return String.fromCodePoint(code);
	} catch {
		return '';
	}
}

/**
 * Validate a raw href and return a SAFE, attribute-encoded value, or null when
 * the URL must be rejected. Accepts:
 *   - absolute URLs with an allowed scheme (http/https/mailto/tel),
 *   - root-relative paths (`/foo`, but NOT scheme-relative `//foo`),
 *   - pure fragments (`#section`) and query-only (`?q=1`).
 */
function sanitizeHref(rawHref: string): string | null {
	const trimmed = rawHref.trim();
	if (trimmed === '') return null;

	const probe = normalizeForSchemeCheck(trimmed).toLowerCase();

	// Reject scheme-relative URLs outright — they inherit the page scheme and are
	// a common bypass for the relative-path branch below.
	if (probe.startsWith('//')) return null;

	// Root-relative, fragment, or query-only links have no scheme — allow them.
	if (probe.startsWith('/') || probe.startsWith('#') || probe.startsWith('?')) {
		return encodeAttr(trimmed);
	}

	// If there is a scheme (token before the first ':' contains no '/' '?' '#'),
	// it must be on the allowlist. Anything with a colon but a non-safe scheme is
	// rejected; a colon appearing only after a path separator is treated as a
	// relative URL and rejected to stay conservative.
	const colonIndex = probe.indexOf(':');
	if (colonIndex !== -1) {
		const beforeColon = probe.slice(0, colonIndex);
		if (/[/?#]/.test(beforeColon)) {
			// Colon is inside a path segment, not a scheme. Reject conservatively —
			// agency links are always absolute or root-relative.
			return null;
		}
		const scheme = `${beforeColon}:`;
		if (!SAFE_URL_SCHEMES.has(scheme)) return null;
		return encodeAttr(trimmed);
	}

	// No scheme and not root-relative/fragment/query: a bare relative path like
	// `foo/bar`. Reject conservatively — agency advisory links are absolute.
	return null;
}

/** Encode a string for safe inclusion inside a double-quoted HTML attribute. */
function encodeAttr(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/** Encode text content so any stripped markup renders inert (literal) text. */
function encodeText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Pull the `href` value out of a raw tag's attribute string. Matches both
 * quoting styles and unquoted values; case-insensitive on the attribute name.
 * Returns the FIRST href encountered (browsers honor the first).
 */
function extractHref(attrs: string): string | null {
	const match =
		/(?:^|\s)href\s*=\s*"([^"]*)"/i.exec(attrs) ??
		/(?:^|\s)href\s*=\s*'([^']*)'/i.exec(attrs) ??
		/(?:^|\s)href\s*=\s*([^\s"'>]+)/i.exec(attrs);
	return match ? match[1] : null;
}

/**
 * Tokenizer regex: matches an HTML comment, a tag, or runs of text. We treat
 * comments as a single unit so `<!-- <script> -->` cannot smuggle markup, and
 * we never recurse into the DOM.
 */
const TOKEN_RE = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|<|[^<]+/g;

/**
 * Sanitize alert HTML into a SAFE subset: only `a[href]`, `b`, `strong`, `br`
 * survive; every link is `rel="noopener noreferrer"` with a vetted scheme; all
 * other tags, attributes, `on*` handlers, comments, `<script>`/`<style>` (incl.
 * their contents) are removed. Disallowed tags are dropped while their text
 * content is preserved (HTML-encoded so it can never re-activate).
 *
 * Pure + SSR-safe: no DOM, no `document`, deterministic on edge and browser.
 */
export function sanitizeAlertHtml(html: string): string {
	if (typeof html !== 'string' || html === '') return '';

	let out = '';
	// When inside a "raw text" element we are dropping (script/style), suppress
	// its text content entirely instead of encoding it.
	let suppressDepth = 0;
	let suppressTag: string | null = null;

	const matches = html.matchAll(TOKEN_RE);
	for (const m of matches) {
		const token = m[0];

		// A bare '<' that did not form a tag — emit it as encoded text.
		if (token === '<') {
			if (suppressDepth === 0) out += '&lt;';
			continue;
		}

		// HTML comment — always dropped.
		if (token.startsWith('<!--')) continue;

		// Tag?
		if (token[0] === '<') {
			const tag = parseTag(token);
			if (!tag) {
				// Not a real element tag (e.g. `<!doctype>`, processing instr.) — drop.
				continue;
			}

			// While suppressing a raw-text element, only its matching close tag matters.
			if (suppressDepth > 0) {
				if (tag.closing && tag.name === suppressTag) {
					suppressDepth = 0;
					suppressTag = null;
				}
				continue;
			}

			// `script` / `style` (and any unknown raw-text-ish element we choose to
			// fully swallow) — enter suppression so their CONTENT is also dropped.
			if (!tag.closing && (tag.name === 'script' || tag.name === 'style')) {
				if (!tag.selfClosing) {
					suppressDepth = 1;
					suppressTag = tag.name;
				}
				continue;
			}

			if (!ALLOWED_TAGS.has(tag.name)) {
				// Disallowed but harmless tag — drop the tag, keep flowing text.
				continue;
			}

			out += renderAllowedTag(tag);
			continue;
		}

		// Plain text run.
		if (suppressDepth === 0) {
			out += encodeText(token);
		}
	}

	return out;
}

interface ParsedTag {
	name: string;
	closing: boolean;
	selfClosing: boolean;
	attrs: string;
}

/** Parse a `<...>` token into its name/closing/self-closing/attr parts. */
function parseTag(token: string): ParsedTag | null {
	// Require a real element name start. Rejects `<!doctype>`, `<?xml?>`, etc.
	const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/.exec(token);
	if (!match) return null;
	const closing = match[1] === '/';
	const name = match[2].toLowerCase();
	let rest = match[3];
	let selfClosing = false;
	if (rest.endsWith('/')) {
		selfClosing = true;
		rest = rest.slice(0, -1);
	}
	return { name, closing, selfClosing, attrs: rest };
}

/** Render an allowed tag with its attributes scrubbed to the safe minimum. */
function renderAllowedTag(tag: ParsedTag): string {
	const { name } = tag;

	if (name === 'br') {
		// `br` is void — emit a single normalized self-closing tag, never a closer.
		return tag.closing ? '' : '<br />';
	}

	if (tag.closing) {
		return `</${name}>`;
	}

	if (name === 'a') {
		const rawHref = extractHref(tag.attrs);
		const href = rawHref != null ? sanitizeHref(rawHref) : null;
		// A link with no usable href becomes a plain anchor with no href — but we
		// still force rel and keep it inert. (Most callers will have a valid href.)
		if (href == null) {
			return `<a rel="${FORCED_REL}">`;
		}
		return `<a href="${href}" rel="${FORCED_REL}">`;
	}

	// b / strong — no attributes are ever allowed.
	return `<${name}>`;
}

// ---------------------------------------------------------------------------
// Alert view-model
// ---------------------------------------------------------------------------

/**
 * Raw alert record as it arrives from the v1 snapshot contract.
 *
 * Copy is bilingual: each rider-facing string has an `_en` and `_fr` variant.
 * `body_*_html` carries the only markup the app trusts (sanitized on render).
 *
 * `header_key` is an INTERNAL label-resolution token (raw FR text). It is NOT
 * rider copy: it must never be rendered, and it must NEVER be passed to
 * `resolveLabel` (per the v1 client contract, `header_key`/`header_text` are
 * raw FR and would corrupt label lookup). It is intentionally accepted here so
 * the view-model can quarantine it — and is never copied onto the output.
 */
export interface RawAlert {
	id: string;
	severity: SeverityCode;
	title_en?: string | null;
	title_fr?: string | null;
	body_en_html?: string | null;
	body_fr_html?: string | null;
	routes?: readonly string[] | null;
	stops?: readonly string[] | null;
	/** INTERNAL ONLY — quarantined, never rendered, never resolved. */
	header_key?: string | null;
	/** INTERNAL ONLY — raw FR header text, never rendered as rider copy. */
	header_text?: string | null;
}

/** Locale-resolved, render-ready alert. `body` is SANITIZED HTML. */
export interface AlertViewModel {
	id: string;
	severity: SeverityCode;
	/** Plain-text title (no markup). */
	title: string;
	/** Sanitized HTML body — safe to inject via `{@html}`. */
	body: string;
	routes: readonly string[];
	stops: readonly string[];
}

/**
 * Pick the locale variant: the requested locale's value when present and
 * non-empty, otherwise the FR fallback, otherwise EN, otherwise "".
 *
 * The contract's "_en when lang==='en' else FR fallback" is implemented as:
 *   - lang 'en' → prefer EN, fall back to FR;
 *   - lang 'fr' → prefer FR, fall back to EN;
 * with empty/nullish treated as absent so we never render a blank string when a
 * translation exists in the other locale.
 */
function pickLocalized(
	en: string | null | undefined,
	fr: string | null | undefined,
	lang: Locale
): string {
	const primary = lang === 'en' ? en : fr;
	const secondary = lang === 'en' ? fr : en;
	if (typeof primary === 'string' && primary.trim() !== '') return primary;
	if (typeof secondary === 'string' && secondary.trim() !== '') return secondary;
	return '';
}

/**
 * Build a render-ready, locale-resolved alert view-model.
 *
 * - `title` is plain text (decoded of any incidental markup via the text path).
 * - `body` is the locale-correct HTML run through `sanitizeAlertHtml`, so it is
 *   safe to render with `{@html vm.body}`.
 * - `header_key` / `header_text` are deliberately NOT copied onto the output —
 *   they are internal label tokens (raw FR) and are never rider-facing nor
 *   eligible for `resolveLabel`.
 */
export function toAlertViewModel(alert: RawAlert, lang: Locale): AlertViewModel {
	const title = pickLocalized(alert.title_en, alert.title_fr, lang);
	const rawBody = pickLocalized(alert.body_en_html, alert.body_fr_html, lang);

	return {
		id: alert.id,
		severity: alert.severity,
		// Titles are plain text — strip any markup an author may have slipped in by
		// running them through the sanitizer, which drops tags and keeps text.
		title: stripTags(title),
		body: sanitizeAlertHtml(rawBody),
		routes: alert.routes ?? [],
		stops: alert.stops ?? []
	};
}

/**
 * Reduce a string to plain text: drop every tag, decode the basic entities the
 * sanitizer emits so callers see real characters in a text context. SSR-safe.
 */
function stripTags(value: string): string {
	return value
		.replace(/<[^>]*>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&')
		.trim();
}
