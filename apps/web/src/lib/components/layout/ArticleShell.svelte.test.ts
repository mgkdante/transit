// ArticleShell.svelte.test.ts — DOM + source gate for the article/masthead spine (§C2.5).
//
// Guards the vertical zone order (kicker → title+dot → lede → meta → tape →
// content), that the title is a REAL heading, that the lede + prose lane are
// capped to the article measure (--container-content / 72ch), and that the
// hazard tape is reused (not reinvented). Layout-only: no data-mark assertions.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ArticleShell from './ArticleShell.svelte';

const meta = createRawSnippet(() => ({
	render: () => `<span data-testid="meta">provider · 12:00Z</span>`,
}));
const content = createRawSnippet(() => ({
	render: () => `<div data-testid="content"><p class="article-prose">Body copy</p></div>`,
}));

const shellSource = () =>
	readFileSync(resolve(process.cwd(), 'src/lib/components/layout/ArticleShell.svelte'), 'utf-8');

describe('ArticleShell — structure', () => {
	it('renders the title as a real heading (level 1 masthead by default) with the brand dot', () => {
		const { container } = render(ArticleShell, { props: { title: 'Metrics reference' } });
		const h1 = container.querySelector('h1');
		expect(h1?.textContent).toContain('Metrics reference');
		expect(container.querySelector('[data-slot="section-heading-dot"]')).not.toBeNull();
	});

	it('honours a custom heading level', () => {
		const { container } = render(ArticleShell, { props: { title: 'Preamble', level: 2 } });
		expect(container.querySelector('h2')).not.toBeNull();
		expect(container.querySelector('h1')).toBeNull();
	});

	it('renders the kicker, lede and meta zones when supplied', () => {
		const { container, getByTestId } = render(ArticleShell, {
			props: { title: 'T', kicker: 'METRICS · REFERENCE', lede: 'The measured contract.', meta },
		});
		expect(container.querySelector('.article-kicker')?.textContent).toBe('METRICS · REFERENCE');
		expect(container.querySelector('.article-lede')?.textContent).toContain(
			'The measured contract.',
		);
		expect(getByTestId('meta')).toBeInTheDocument();
	});

	it('omits optional zones when their props are absent', () => {
		const { container } = render(ArticleShell, { props: { title: 'T' } });
		expect(container.querySelector('.article-kicker')).toBeNull();
		expect(container.querySelector('.article-lede')).toBeNull();
		expect(container.querySelector('[data-slot="article-meta"]')).toBeNull();
		expect(container.querySelector('[data-slot="article-content"]')).toBeNull();
	});

	it('renders the content region and its prose child', () => {
		const { getByTestId, container } = render(ArticleShell, {
			props: { title: 'T', children: content },
		});
		expect(getByTestId('content')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="article-content"] .article-prose')).not.toBeNull();
	});

	it('wires the heading id for a section aria-labelledby', () => {
		const { container } = render(ArticleShell, {
			props: { title: 'T', headingId: 'metrics-head' },
		});
		expect(container.querySelector('#metrics-head')?.textContent).toContain('T');
	});
});

describe('ArticleShell — vertical zone order', () => {
	it('orders head → tape → content in source order', () => {
		const { container } = render(ArticleShell, {
			props: { title: 'T', kicker: 'K', lede: 'L', meta, children: content },
		});
		const shell = container.querySelector('[data-slot="article-shell"]')!;
		const kinds = Array.from(shell.children).map(
			(el) => el.getAttribute('data-slot') ?? el.className,
		);
		// head block, then the hazard tape, then the content block.
		const headIdx = kinds.findIndex((k) => k.includes('article-head'));
		const contentIdx = kinds.indexOf('article-content');
		expect(headIdx).toBeGreaterThanOrEqual(0);
		expect(contentIdx).toBeGreaterThan(headIdx);
	});

	it('orders kicker → heading → lede → meta inside the head', () => {
		const { container } = render(ArticleShell, {
			props: { title: 'T', kicker: 'K', lede: 'L', meta },
		});
		const head = container.querySelector('.article-head')!;
		const marks = Array.from(head.children).map(
			(el) => el.getAttribute('data-slot') ?? el.className,
		);
		expect(marks[0]).toContain('article-kicker');
		expect(marks[1]).toContain('section-heading'); // the SectionHeading wrapper
		expect(marks[2]).toContain('article-lede');
		expect(marks[3]).toContain('article-meta');
	});
});

describe('ArticleShell — measure + tape (source contract)', () => {
	it('caps the lede + content prose lane to min(--container-content, 72ch)', () => {
		const src = shellSource();
		expect(src).toMatch(
			/\.article-lede\s*\{[^}]*max-width:\s*min\(var\(--container-content\),\s*72ch\)/,
		);
		expect(src).toMatch(
			/\.article-prose\)\s*\{[^}]*max-width:\s*min\(var\(--container-content\),\s*72ch\)/,
		);
	});

	it('reuses the hazard Separator (does not reinvent the tape)', () => {
		const src = shellSource();
		expect(src).toMatch(/Separator[\s\S]*variant="hazard"/);
	});

	it('drops the tape when tape={false}', () => {
		const { container } = render(ArticleShell, { props: { title: 'T', tape: false } });
		expect(container.querySelector('.article-tape')).toBeNull();
	});
});
