// dataviz-doctrine gate engine (no-primary-in-dataviz) — extracted from
// transit's apps/web/src/tests/brand-doctrine.test.ts (Gate 2). A data mark
// must be encoded with the dataviz scale, NEVER the semantic affordance tokens
// (--primary / --success / --destructive / --accent): orange is
// INTERACTIVE-ONLY; green/red are affordance verdicts, not data.
//
// Two-track scan contract (byte-equivalent): violations are detected on
// comment-STRIPPED source; the allow-marker window (default 8 ORIGINAL lines
// above the hit) is checked on the original so an annotating comment can clear
// a genuine interactive affordance.
import { blankComments } from './comments.js';

export const DEFAULT_AFFORDANCE_TOKENS = ['primary', 'success', 'destructive', 'accent'] as const;

/** Recognised allowlist markers (checked on ORIGINAL source, incl. comments). */
export const DEFAULT_ALLOW_MARKERS = [
	'dataviz-allow: interactive',
] as const;

export interface DatavizDoctrineConfig {
	affordanceTokens?: readonly string[];
	allowMarkers?: readonly string[];
	/** Lines ABOVE a hit in which a marker clears it. Source gate: 8. */
	markerWindow?: number;
}

export function buildFillPatterns(affordanceTokens: readonly string[]): RegExp[] {
	const AFFORDANCE = `(?:${affordanceTokens.join('|')})`;
	return [
		// fill="var(--primary)" / stroke='var(--success)'
		new RegExp(`(?:fill|stroke)\\s*=\\s*["']?var\\(--${AFFORDANCE}\\)`),
		// bg-[var(--primary)] / fill-[var(--success)]
		new RegExp(`(?:bg|fill|stroke|text)-\\[var\\(--${AFFORDANCE}\\)\\]`),
		// bg-primary / bg-success / text-destructive / fill-destructive utility classes
		new RegExp(`\\b(?:bg|fill|stroke|text)-${AFFORDANCE}\\b`),
		// CSS: background: var(--primary); color: var(--success); fill: var(--destructive)
		new RegExp(`(?:background|background-color|color|fill|stroke)\\s*:\\s*var\\(--${AFFORDANCE}\\)`),
	];
}

/** Scan one file's source; returns 'L<n>: <trimmed line>' entries. */
export function datavizViolations(src: string, config: DatavizDoctrineConfig = {}): string[] {
	const fillPatterns = buildFillPatterns(config.affordanceTokens ?? DEFAULT_AFFORDANCE_TOKENS);
	const allowMarkers = config.allowMarkers ?? DEFAULT_ALLOW_MARKERS;
	const markerWindow = config.markerWindow ?? 8;
	const original = src.split('\n');
	// Comments blanked IN PLACE → line numbers stay aligned with `original`.
	const scanned = blankComments(src).split('\n');
	const bad: string[] = [];
	scanned.forEach((line, i) => {
		if (!fillPatterns.some((re) => re.test(line))) return;
		const window = original.slice(Math.max(0, i - markerWindow), i + 1).join('\n');
		if (allowMarkers.some((m) => window.includes(m))) return;
		bad.push(`L${i + 1}: ${line.trim()}`);
	});
	return bad;
}
