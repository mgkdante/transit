// style-regressions.test.ts — the FORBIDDEN guard (P5.3d §C4).
//
// The vibe kill-table sweep (P1–P12) retired four recurring anti-patterns from
// the `<style>` blocks. This gate makes those kills permanent: once a pattern is
// swept out of a directory, it can never come back. The detection engine is the
// vendored `styleRegressionViolations` (byte-equivalent to yesid.dev's
// style-regressions gate); the FORBIDDEN table + the scan roots are transit's
// per-app taste contract and live here.
//
// SCOPE (P5.3d stage B): the sweep is COMPLETE site-wide. Stage A cleared
// `lib/features/{map,lines}`; stage B cleared everything else —
// `lib/components/**` (ui/brand/dataviz edge, shared, shell, layout, surface,
// map canvas), `routes/**`, and the remaining `lib/features/**` surfaces. The
// guard now runs over the whole component + route tree with an EMPTY allowlist
// (§C4: "Allowlists start and stay EMPTY."). The FORBIDDEN table is site-final
// and must never grow an exception.
//
// FROZEN EXEMPTION (§C4 P8): the P5.2 chart marks under
// `lib/components/dataviz/chart/marks/**` are FROZEN — the sweep does not touch
// them and this guard does not scan them. Their stroke/dash literals and any
// pre-existing token fallbacks are the mark contract's business, out of scope
// for the vibe kill-table. This is a directory exclusion, NOT an allowlist: no
// individual violation is ever pinned, and the exclusion is expressed as a path
// prefix so nothing in the swept tree can hide behind it.
//
// The four FORBIDDEN patterns (§C4):
//   1. STRIPES — border-(left|inline-start|top) accent rules on the brand tokens
//      (dataviz/primary/accent/rule). Retired by P7; they can't return.
//   2. RAW MS — a bare `<n>ms` duration/easing literal in a transition/animation.
//      All motion flows through `--duration-*`/`--ease-*` (P2).
//   3. TOKEN FALLBACKS — `var(--duration|ease|radius|space…, <fallback>)`. tokens
//      are always loaded; the fallback is where the drift/lies lived (P2).
//   4. TEXT-SHADOW GLOW — `text-shadow` on a glow/primary/accent token. Glow is
//      never text (P-glow law); a neutral legibility halo is fine.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { styleRegressionViolations, type ForbiddenPattern } from '@yesid/gates';

// The FORBIDDEN table — site-final (§C4). No entry may be relaxed or removed.
const FORBIDDEN: readonly ForbiddenPattern[] = [
	{
		pattern:
			/border-(left|inline-start|top):\s*[23]px\s+solid\s+(var\(--(dataviz|primary|accent|rule|border-rule)|color-mix)/,
		reason:
			'stripe: a 2px/3px accent border-rule (P7 retired these). Carry the signal with StatusBadge / a severity chip / a full border-color / the numbered chip instead.',
	},
	{
		pattern: /border-(left|l)-\[?[^\];]*\b(dataviz|primary|accent|rule)\b[^\];]*\]?\s+/,
		reason: 'stripe: a Tailwind border-left utility on a brand token (P7 retired these).',
	},
	{
		pattern:
			/transition:[^;]*\b\d+ms\b|animation:[^;]*\b\d+ms\b|\btransition-duration:\s*\d+ms|\banimation-duration:\s*\d+ms/,
		reason:
			'raw motion literal: a bare <n>ms in a transition/animation. Use --duration-* / --ease-* tokens (P2).',
	},
	{
		pattern: /var\(--(duration|ease|radius|space|spacing)[a-z0-9-]*,/,
		reason:
			'token fallback: var(--token, <fallback>) for a duration/ease/radius/space token. tokens.css is always loaded — drop the fallback (P2 no-fallback law).',
	},
	{
		pattern: /text-shadow:[^;]*var\(--(glow|primary|accent)/,
		reason:
			'text-shadow glow: glow is never text (the glow-never-text law). A neutral legibility halo (e.g. var(--background)) is fine; a glow/primary/accent one is not.',
	},
];

// Swept roots — site-wide after stage B. The whole component + route tree is
// under the guard.
const FORBIDDEN_ROOTS = ['src/lib/components', 'src/lib/features', 'src/routes'] as const;

// Frozen-marks exclusion (§C4 P8). Any hit whose path is under the chart-marks
// directory is dropped from the report: the P5.2 chart marks are off-limits to
// the sweep, so the guard must not force an edit inside them. The engine emits
// hit paths with the SCAN ROOT replaced by 'src' (so under the
// 'src/lib/components' root a mark reads 'src/dataviz/chart/marks/…'); match on
// the directory segment to stay independent of which root produced the hit.
const FROZEN_MARKS_SEGMENT = 'dataviz/chart/marks/';

describe('style regressions — the FORBIDDEN guard (P5.3d §C4)', () => {
	for (const rel of FORBIDDEN_ROOTS) {
		const root = resolve(process.cwd(), rel);

		describe(rel, () => {
			const results = styleRegressionViolations({ root, forbidden: FORBIDDEN }).map((r) => ({
				...r,
				// Drop frozen-marks hits (§C4 P8) — the sweep never edits those files.
				hits: r.hits.filter((h) => !h.includes(FROZEN_MARKS_SEGMENT)),
			}));

			it('scans a non-empty tree (guards against a wrong path)', () => {
				// Every root has .svelte files; if the walk found none the path is wrong.
				expect(results.length).toBe(FORBIDDEN.length);
			});

			for (const { reason, hits } of results) {
				it(`no ${reason}`, () => {
					expect(hits, `${rel}: ${reason}\n${hits.join('\n')}`).toEqual([]);
				});
			}
		});
	}
});
