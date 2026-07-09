// design-tokens-drift.test.ts — P5.1 value-drift gate between transit's
// tokens.json and the vendored @yesid/tokens BASE (vendor/design/tokens).
//
// The contract: transit runs the yesid brand. Every token path both files
// define must carry the SAME value — except the DECLARED_OVERRIDES below,
// transit's deliberate, documented divergences (each a P5.3 reconciliation
// candidate). This is the cascade mechanism working as designed: a brand bump
// that changes a shared value fails HERE until transit either takes the new
// value (regenerate + commit) or promotes the divergence into this register.
//
// Transit-ONLY tokens (dataviz vehicle aliases, map-stop-fill, tracking.*,
// light shadow re-pins) and base-ONLY tokens (component text sizes, cta
// shadows, z.overlay/ripple, color.brand.glow) are legal — only SHARED paths
// are value-locked. The dataviz families are shared as of design v0.2.0, so
// the whole dataviz scale is gate-locked to the brand base. As of design
// v0.3.0 (P5.3a·E4) the shadow.glow-* basis and space.page-x floor were
// reconciled to the brand base, shrinking the override register from 6 to 2.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const transitTokens = JSON.parse(
	readFileSync(resolve(process.cwd(), 'tools/tokens/tokens.json'), 'utf-8'),
) as Record<string, unknown>;
const baseTokens = JSON.parse(
	readFileSync(resolve(process.cwd(), 'vendor/design/tokens/tokens.json'), 'utf-8'),
) as Record<string, unknown>;

/**
 * Transit's deliberate divergences from the brand base — the exhaustive list.
 * Each entry pins BOTH sides, so it goes stale loudly if either repo moves.
 */
const DECLARED_OVERRIDES: Record<string, { base: unknown; transit: unknown; why: string }> = {
	// P5.3a·E4 (design v0.3.0, 2026-07-03): the register dropped 6→2. transit
	// RECONCILED the shadow.glow-{sm,md,lg} basis (--primary → --glow) and
	// space.page-x mobile floor (1rem → 1.5rem) UP to the brand base, so those
	// four paths are now SHARED-and-matching and need no override. The two
	// scanability type re-pins below remain deliberate divergences.
	'text.heading': {
		base: { min: '1.25rem', preferred: '3vw', max: '1.5rem' },
		transit: { min: '1.375rem', preferred: '3vw', max: '1.75rem' },
		why: 'transit headings sized up one step for scanability on data pages',
	},
	'text.micro': {
		base: '0.6875rem',
		transit: '0.75rem',
		why: 'micro readouts floor-bumped for dense chart annotations',
	},
};

type Leaf = { path: string; value: unknown };

function leaves(node: unknown, prefix = '', out: Leaf[] = []): Leaf[] {
	if (node && typeof node === 'object') {
		const rec = node as Record<string, unknown>;
		if ('$value' in rec) {
			out.push({ path: prefix, value: rec['$value'] });
			return out;
		}
		for (const [k, v] of Object.entries(rec)) {
			if (k.startsWith('$')) continue;
			leaves(v, prefix ? `${prefix}.${k}` : k, out);
		}
	}
	return out;
}

const transitLeaves = new Map(leaves(transitTokens).map((l) => [l.path, l.value]));
const baseLeaves = new Map(leaves(baseTokens).map((l) => [l.path, l.value]));

describe('design-token drift vs the vendored @yesid/tokens base', () => {
	it('every SHARED token path matches the base value (minus the declared overrides)', () => {
		const drift: string[] = [];
		for (const [path, value] of transitLeaves) {
			if (!baseLeaves.has(path) || path in DECLARED_OVERRIDES) continue;
			const baseValue = baseLeaves.get(path);
			if (JSON.stringify(value) !== JSON.stringify(baseValue)) {
				drift.push(`${path}: transit=${JSON.stringify(value)} base=${JSON.stringify(baseValue)}`);
			}
		}
		expect(
			drift,
			`shared token values drifted from the brand base — take the bump or declare the override:\n${drift.join('\n')}`,
		).toEqual([]);
	});

	it('every declared override is real on both sides (no stale register entries)', () => {
		for (const [path, decl] of Object.entries(DECLARED_OVERRIDES)) {
			expect(transitLeaves.has(path), `${path} missing from transit tokens.json`).toBe(true);
			expect(baseLeaves.has(path), `${path} missing from the vendored base`).toBe(true);
			expect(JSON.stringify(transitLeaves.get(path)), `${path} (transit side moved)`).toBe(
				JSON.stringify(decl.transit),
			);
			expect(JSON.stringify(baseLeaves.get(path)), `${path} (base side moved)`).toBe(
				JSON.stringify(decl.base),
			);
		}
	});

	it('the dataviz scale is fully shared and gate-locked (no transit-only dataviz leaves besides the vehicle aliases)', () => {
		const transitDataviz = [...transitLeaves.keys()].filter(
			(p) => p.includes('.dataviz.') && !p.startsWith('color.brand.dataviz.'),
		);
		expect(transitDataviz.length).toBeGreaterThan(0);
		const missing = transitDataviz.filter((p) => !baseLeaves.has(p));
		expect(missing, `dataviz leaves missing from the base:\n${missing.join('\n')}`).toEqual([]);
	});
});
