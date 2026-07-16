import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import ArticleHeader from './ArticleHeader.svelte';

const TAGS_ARIA = 'Article keywords';
const controls = createRawSnippet(() => ({
	render: () => '<button type="button" data-testid="article-control">Control</button>',
}));
const actions = createRawSnippet(() => ({
	render: () => '<a href="/map" data-testid="article-action">Map</a>',
}));

const baseProps = {
	watermark: 'Method',
	category: 'METHOD · MEASUREMENT SCIENCE',
	title: 'How we measure reliability',
	tags: ['measure', 'reliability'],
	tagsAria: TAGS_ARIA,
	backHref: '/',
	backLabel: '← Back to the dashboard',
	meta: [{ text: 'Jul 9, 2026', datetime: '2026-07-09T12:00:00Z' }, '12 metrics', '2 families'],
	edgeLeft: 'LINE 24',
	edgeRight: 'JUL 9 2026',
	controls,
};

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf-8');

describe('ArticleHeader — article anatomy', () => {
	it('renders one h1, one back link, category, watermark, labelled keyword list, meta, and optional controls', () => {
		const { container } = render(ArticleHeader, { props: baseProps });

		expect(container.querySelectorAll('h1')).toHaveLength(1);
		expect(screen.getByRole('heading', { level: 1, name: baseProps.title })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: baseProps.backLabel })).toHaveAttribute(
			'href',
			baseProps.backHref,
		);
		expect(screen.getByText(baseProps.category)).toBeInTheDocument();
		expect(screen.getByText(baseProps.watermark)).toBeInTheDocument();

		const tags = screen.getByRole('list', { name: TAGS_ARIA });
		expect(within(tags).getAllByRole('listitem')).toHaveLength(baseProps.tags.length);
		for (const tag of baseProps.tags) expect(within(tags).getByText(tag)).toBeInTheDocument();

		expect(container.querySelectorAll('.header__meta-sep')).toHaveLength(2);
		expect(screen.getByText('12 metrics')).toBeInTheDocument();
		expect(screen.getByText('2 families')).toBeInTheDocument();
		expect(screen.getByTestId('article-control')).toBeInTheDocument();
	});

	it('keeps auxiliary actions before a centered collapse-control row that is always last', () => {
		const { container } = render(ArticleHeader, {
			props: { ...baseProps, actions },
		});
		const content = container.querySelector('.header__content') as HTMLElement;
		const actionRow = container.querySelector('[data-slot="article-header-actions"]');
		const controlRow = container.querySelector('[data-slot="article-header-controls"]');

		expect(actionRow).toContainElement(screen.getByTestId('article-action'));
		expect(controlRow).toContainElement(screen.getByTestId('article-control'));
		expect(Array.from(content.children).at(-1)).toBe(controlRow);

		const article = source('src/lib/components/layout/ArticleHeader.svelte');
		expect(article).toMatch(/\.header__actions[^{]*\{[\s\S]*?justify-content:\s*center/);
		expect(article).toMatch(/\.header__controls[^{]*\{[\s\S]*?justify-content:\s*center/);
	});

	it('renders structured dated meta as semantic time', () => {
		render(ArticleHeader, { props: baseProps });
		const time = screen.getByText('Jul 9, 2026').closest('time');
		expect(time).not.toBeNull();
		expect(time).toHaveAttribute('datetime', '2026-07-09T12:00:00Z');
	});

	it('keeps a labelled meta value and its separator in one unbreakable item', () => {
		const { container } = render(ArticleHeader, {
			props: {
				...baseProps,
				meta: [
					{
						label: 'BILAN QUOTIDIEN À JOUR AU',
						text: '7 juill. 2026, 20 h 00',
						datetime: '2026-07-08T00:00:00Z',
					},
					'8 sections',
				],
			},
		});

		const pair = container.querySelector('.header__meta-pair');
		expect(pair).toHaveTextContent('BILAN QUOTIDIEN À JOUR AU');
		expect(pair).toHaveTextContent('7 juill. 2026, 20 h 00');
		expect(pair?.closest('.header__meta-item')).toContainElement(container.querySelector('time'));
		expect(container.querySelectorAll('.header__meta-sep')).toHaveLength(1);

		const article = source('src/lib/components/layout/ArticleHeader.svelte');
		expect(article).toMatch(/\.header__meta-pair\s*\{[\s\S]*?white-space:\s*nowrap/);
	});

	it('reserves the meta row with an inert skeleton while metadata is loading', () => {
		const { container } = render(ArticleHeader, {
			props: { ...baseProps, meta: [], metaPending: true },
		});
		const meta = container.querySelector('.header__meta');
		const skeleton = container.querySelector('.header__meta-skeleton');

		expect(meta).toHaveAttribute('data-pending', 'true');
		expect(skeleton).toHaveAttribute('aria-hidden', 'true');

		const article = source('src/lib/components/layout/ArticleHeader.svelte');
		expect(article).toMatch(/\.header__meta\s*\{[\s\S]*?min-height:\s*1rem/);
	});

	it('highlights the first keyword when it appears in the title', () => {
		const { container } = render(ArticleHeader, { props: baseProps });
		const highlight = container.querySelector('.header__title-highlight');
		expect(highlight).toHaveTextContent('measure');
		expect(container.querySelectorAll('.header__title-highlight')).toHaveLength(1);
	});

	it('does not fall through to later keywords when the first keyword is absent', () => {
		const { container } = render(ArticleHeader, {
			props: { ...baseProps, tags: ['schedule', 'measure'] },
		});
		expect(container.querySelector('.header__title-highlight')).toBeNull();
	});

	it('renders the exact circuit-grid and ManifestoCanvas layers', () => {
		const { container } = render(ArticleHeader, { props: baseProps });
		const root = container.querySelector('[data-slot="article-header"]');
		expect(root?.querySelector(':scope > .header__circuit-grid.detail-header-grid')).not.toBeNull();
		expect(root?.querySelector(':scope > canvas[data-testid="manifesto-canvas"]')).not.toBeNull();
		expect(root?.querySelector(':scope > .manifesto__warm-glow')).not.toBeNull();
	});

	it('keeps every decorative layer out of the accessibility tree', () => {
		const { container } = render(ArticleHeader, { props: baseProps });
		for (const selector of [
			'.header__circuit-grid',
			'canvas[data-testid="manifesto-canvas"]',
			'.manifesto__warm-glow',
			'.header__watermark',
			'.header__edge-left',
			'.header__edge-right',
		]) {
			expect(container.querySelector(selector), selector).toHaveAttribute('aria-hidden', 'true');
		}
	});
});

describe('ArticleHeader — exact source contract', () => {
	it('cancels the Transit document pad plus the source padding while keeping source-aligned heights', () => {
		const article = source('src/lib/components/layout/ArticleHeader.svelte');
		expect(article).toMatch(/margin-top:\s*calc\(-2 \* var\(--chrome-offset\)\)/);
		expect(article).toMatch(/padding-top:\s*var\(--chrome-offset\)/);
		expect(article).toMatch(/min-height:\s*380px/);
		expect(article).toMatch(/@media\s*\(min-width:\s*1024px\)[\s\S]*?min-height:\s*440px/);
	});

	it('uses yesid exact shared grid values', () => {
		const css = source('src/app.css');
		expect(css).toContain('repeating-linear-gradient(90deg');
		expect(css).toContain('transparent 80px');
		expect(css).toContain('radial-gradient(circle 2.5px at 80px 80px');
		expect(css).toContain('radial-gradient(circle 2px at 160px 160px');
		expect(css).toContain('background-size: 320px 320px');
	});

	it('guards the long bilingual category line at narrow phone widths', () => {
		const article = source('src/lib/components/layout/ArticleHeader.svelte');
		expect(article).toMatch(/@media\s*\(max-width:\s*390px\)[\s\S]*?\.header__cat-line/);
		expect(article).toMatch(/\.header__cat-line[\s\S]*?max-width:\s*calc\(100% - 2rem\)/);
	});

	it('renders source-aligned factual edge labels without a title glow', () => {
		const { container } = render(ArticleHeader, { props: baseProps });
		const article = source('src/lib/components/layout/ArticleHeader.svelte');
		expect(container.querySelector('.header__edge-left')).toHaveTextContent(baseProps.edgeLeft);
		expect(container.querySelector('.header__edge-right')).toHaveTextContent(baseProps.edgeRight);
		expect(article).toMatch(/left:\s*24px[\s\S]*?rotate\(-90deg\)/);
		expect(article).toMatch(/right:\s*24px[\s\S]*?rotate\(90deg\)/);
		expect(article).not.toMatch(/text-shadow/);
	});

	it('keeps article composition blueprint-free while preserving the shared blueprint toolkit', () => {
		const article = source('src/lib/components/layout/ArticleHeader.svelte');
		expect(article).not.toMatch(/blueprint/i);
		for (const path of [
			'src/lib/components/brand/BlueprintShell.svelte',
			'src/lib/components/svg/detail/BlueprintDetailBogie.svelte',
			'src/lib/components/svg/transit/BlueprintBridge.svelte',
			'src/lib/components/svg/transit/BlueprintCatenary.svelte',
			'src/lib/components/svg/transit/BlueprintSignal.svelte',
			'src/lib/components/svg/transit/BlueprintStationSection.svelte',
			'src/lib/components/svg/transit/BlueprintTrackPlan.svelte',
			'src/lib/motion/scrubs/blueprint-scrub.ts',
			'src/lib/motion/scrubs/blueprint-scrub.test.ts',
		]) {
			expect(existsSync(resolve(process.cwd(), path)), path).toBe(true);
		}
	});

	it('includes reduced-motion fallbacks for transitions, ripples, and canvas painting', () => {
		const article = source('src/lib/components/layout/ArticleHeader.svelte');
		const canvas = source('src/lib/components/brand/ManifestoCanvas.svelte');
		expect(article).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
		expect(article).toMatch(/\.manifesto__ripple-inner[\s\S]*?animation:\s*none/);
		expect(canvas).toContain('isPrefersReducedMotion()');
		expect(canvas).toContain('paintStatic()');
	});
});
