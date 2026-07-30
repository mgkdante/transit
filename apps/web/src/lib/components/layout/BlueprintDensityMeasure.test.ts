import { afterEach, describe, expect, it } from 'vitest';
import { measureBlueprintDocument } from '../../../../scripts/blueprint-density-core.mjs';

const tokenValues = {
	'--blueprint-ink-quiet': 0.14,
	'--blueprint-ink-mid': 0.22,
	'--blueprint-ink-accent': 0.3,
};

function box(left: number, top: number, width: number, height: number): DOMRect {
	return {
		x: left,
		y: top,
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	} as DOMRect;
}

function setBox(selector: string, rect: DOMRect) {
	const element = document.querySelector(selector);
	if (!element) throw new Error(`Missing test element: ${selector}`);
	element.getBoundingClientRect = () => rect;
}

describe('blueprint browser measurement', () => {
	afterEach(() => {
		document.documentElement.removeAttribute('style');
		document.documentElement.setAttribute('data-theme', 'dark');
		document.body.replaceChildren();
	});

	it('uses the full ancestor opacity chain and reports shell reference labels separately', () => {
		document.documentElement.setAttribute('data-theme', 'dark');
		for (const [name, value] of Object.entries(tokenValues)) {
			document.documentElement.style.setProperty(name, String(value));
		}
		document.body.innerHTML = `
			<header data-slot="blueprint-listing-header" style="opacity:0.8">
				<div class="listing-header-text" style="opacity:1"></div>
				<div data-slot="listing-header-stats" style="opacity:1"></div>
				<div class="hero-svg" style="opacity:0.4">
					<svg data-blueprint-layer="hero" data-blueprint-part="hero" style="opacity:0.5"></svg>
				</div>
				<div class="edge-details" style="opacity:0.5">
					<svg
						class="edge-detail"
						data-blueprint-part="detail"
						style="opacity:0.35;--blueprint-part-ink:var(--blueprint-ink-quiet)"
					></svg>
				</div>
				<span class="ref-label" style="opacity:1">DWG: TEST</span>
			</header>
		`;
		setBox('[data-slot="blueprint-listing-header"]', box(0, 0, 100, 100));
		setBox('.listing-header-text', box(0, 70, 40, 20));
		setBox('[data-slot="listing-header-stats"]', box(70, 70, 25, 20));
		setBox('[data-blueprint-layer="hero"]', box(0, 0, 100, 100));
		setBox('[data-blueprint-part="detail"]', box(40, 0, 20, 40));
		setBox('.ref-label', box(5, 75, 20, 5));

		const result = measureBlueprintDocument({
			headerSelector: '[data-slot="blueprint-listing-header"]',
			routeName: 'lines',
			tokenValues,
			url: 'https://preview.example.test/lines',
		});
		const hero = result.parts.find((part) => part.hero);
		const detail = result.parts.find((part) => part.part === 'detail');
		expect(hero).toBeDefined();
		expect(detail).toBeDefined();
		if (!hero || !detail) throw new Error('Expected measured hero and detail parts');

		expect(hero).toMatchObject({ ownOpacity: 0.5 });
		expect(hero.renderedOpacity).toBeCloseTo(0.16);
		expect(detail).toMatchObject({ ownOpacity: 0.35 });
		expect(detail.renderedOpacity).toBeCloseTo(0.14);
		expect(result.appliedTheme).toBe('dark');
		expect(result.copyZones).toHaveLength(2);
		expect(result.refLabelWarnings).toEqual([
			expect.objectContaining({ zone: 'title-lede', text: 'DWG: TEST' }),
		]);
	});
});
