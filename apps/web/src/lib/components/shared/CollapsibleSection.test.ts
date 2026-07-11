// CollapsibleSection.test.ts - the reusable collapsible section card.
//
// Ported from yesid.dev's gate (quiet-mode cases dropped: transit has no
// quiet-mode store). Covers: title + children, numbered badge, toggle, the
// non-collapsible (static) variant, accent CSS var, the data-toc anchor the
// shared TOC scrolls to, and the whole-card toggle contract (interactive
// children never toggle; the header stays the semantic aria-expanded button).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import CollapsibleSection from './CollapsibleSection.svelte';

const bodyContent = createRawSnippet(() => ({
	render: () => `<div>
		<p data-testid="body-text">Plain prose body</p>
		<button type="button" data-testid="body-button">Child action</button>
		<span role="button" tabindex="0" data-testid="body-rolebutton">Faux button</span>
		<a href="/lines" data-testid="body-link">Child link</a>
	</div>`,
}));

const componentSource = () =>
	readFileSync(
		resolve(process.cwd(), 'src/lib/components/shared/CollapsibleSection.svelte'),
		'utf-8',
	);

function cssRule(source: string, selector: RegExp): string {
	return source.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, selector.flags))?.[1] ?? '';
}

describe('CollapsibleSection', () => {
	it('renders title and children when open', () => {
		const { getByText } = render(CollapsibleSection, {
			props: { title: 'Overview', open: true },
		});
		expect(getByText('Overview')).toBeTruthy();
	});

	it('renders a zero-padded numbered badge when index is provided', () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Step', open: true, index: 0 },
		});
		const badge = container.querySelector('[data-slot="badge"]');
		expect(badge?.textContent?.trim()).toBe('01');
	});

	it('toggles body visibility on header click when collapsible', async () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Test', open: true, collapsible: true },
		});
		const button = container.querySelector('button.section-header');
		expect(button).toBeTruthy();
		const body = container.querySelector('.section-body');
		expect(body?.getAttribute('data-state')).toBe('open');
		await fireEvent.click(button!);
		expect(body?.getAttribute('data-state')).toBe('closed');
	});

	it('renders as a static div (not a button) when collapsible is false', () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Static', open: true, collapsible: false },
		});
		expect(container.querySelector('button.section-header')).toBeNull();
	});

	it('sets the accent color as a --accent CSS custom property', () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Amber', open: true, accentColor: 'var(--accent-text)' },
		});
		const card = container.querySelector('.section-card') as HTMLElement;
		expect(card.style.getPropertyValue('--accent')).toBe('var(--accent-text)');
	});

	it('emits the data-toc anchor so the shared TOC can target it', () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Anchored', open: true, anchor: 'overview' },
		});
		const card = container.querySelector('.section-card') as HTMLElement;
		expect(card.getAttribute('data-toc')).toBe('overview');
	});
});

describe('CollapsibleSection - article summary header', () => {
	it('uses a real h2 whose only child is the disclosure button', () => {
		const { container } = render(CollapsibleSection, {
			props: {
				title: 'Service reliability',
				subtitle: 'How consistently riders receive the scheduled service.',
				open: false,
				headerVariant: 'article-summary',
			},
		});
		const card = container.querySelector('[data-slot="card"]');
		const heading = container.querySelector('h2.section-heading');
		const button = heading?.firstElementChild as HTMLButtonElement | null;

		expect(card).toHaveAttribute('data-header-variant', 'article-summary');
		expect(heading).toBeTruthy();
		expect(heading?.children).toHaveLength(1);
		expect(button).toHaveClass('section-header');
		expect(button?.tagName).toBe('BUTTON');
		expect(button).toHaveAccessibleName('Service reliability');
		expect(button).toHaveAttribute('aria-expanded', 'false');
	});

	it('associates each visible subtitle by a unique id without changing the button name', () => {
		const first = render(CollapsibleSection, {
			props: {
				title: 'Observed service',
				subtitle: 'What riders experienced during the selected period.',
				headerVariant: 'article-summary',
			},
		});
		const second = render(CollapsibleSection, {
			props: {
				title: 'Scheduled service',
				subtitle: 'What the published timetable promised.',
				headerVariant: 'article-summary',
			},
		});
		const firstSubtitle = first.container.querySelector(
			'.section-subtitle--article-summary',
		) as HTMLElement | null;
		const secondSubtitle = second.container.querySelector(
			'.section-subtitle--article-summary',
		) as HTMLElement | null;
		const firstButton = first.container.querySelector(
			'button.section-header',
		) as HTMLButtonElement;
		const firstSubtitleId = firstSubtitle?.id ?? '';
		const secondSubtitleId = secondSubtitle?.id ?? '';

		expect(firstSubtitleId).not.toBe('');
		expect(secondSubtitleId).not.toBe('');
		expect(firstSubtitleId).not.toBe(secondSubtitleId);
		expect(firstButton).toHaveAttribute('aria-describedby', firstSubtitleId);
		expect(firstButton).toHaveAccessibleName('Observed service');
	});

	it('unclamps the complete subtitle when the disclosure opens', async () => {
		const summary =
			'This complete analytical summary remains in the DOM while its closed presentation is clamped.';
		const { container } = render(CollapsibleSection, {
			props: {
				title: 'Trend interpretation',
				subtitle: summary,
				open: false,
				headerVariant: 'article-summary',
			},
		});
		const button = container.querySelector('button.section-header') as HTMLButtonElement;
		const subtitle = container.querySelector(
			'.section-subtitle--article-summary',
		) as HTMLElement;

		expect(subtitle).toHaveAttribute('data-state', 'closed');
		expect(subtitle.textContent?.trim()).toBe(summary);
		await fireEvent.click(button);
		expect(subtitle).toHaveAttribute('data-state', 'open');
		expect(subtitle.textContent?.trim()).toBe(summary);
		expect(button).toHaveAttribute('aria-expanded', 'true');
	});

	it('keeps title-only article summaries compact and undescribed', () => {
		const { container } = render(CollapsibleSection, {
			props: {
				title: 'Title only',
				headerVariant: 'article-summary',
			},
		});
		const button = container.querySelector('button.section-header');

		expect(button).toHaveClass('section-header--title-only');
		expect(button).not.toHaveAttribute('aria-describedby');
		expect(container.querySelector('.section-subtitle--article-summary')).toBeNull();
	});

	it('locks the article-summary geometry, typography, and closed-only clamp', () => {
		const source = componentSource();
		const cardRule = cssRule(
			source,
			/:global\(\[data-slot='card'\]\.section-card\.section-card--article-summary\)/,
		);
		const headingRule = cssRule(source, /\.section-heading/);
		const headerRule = cssRule(source, /\.section-header--article-summary/);
		const markedHeaderRule = cssRule(
			source,
			/\.section-header--article-summary\.section-header--with-mark/,
		);
		const titleOnlyRule = cssRule(
			source,
			/\.section-header--article-summary\.section-header--title-only/,
		);
		const markRule = cssRule(source, /\.section-header__mark/);
		const chevronRule = cssRule(
			source,
			/\.section-header--article-summary :global\(\[data-slot='chevron-toggle'\]\)/,
		);
		const titleRule = cssRule(source, /\.section-title--article-summary/);
		const subtitleRule = cssRule(source, /\.section-subtitle--article-summary/);
		const markedSubtitleRule = cssRule(
			source,
			/\.section-subtitle--article-summary\.section-subtitle--with-mark/,
		);
		const subtitleTextRule = cssRule(source, /\.section-subtitle__text/);
		const markedSubtitleTextRule = cssRule(
			source,
			/\.section-subtitle--with-mark \.section-subtitle__text/,
		);
		const closedTextRule = cssRule(
			source,
			/\.section-subtitle--article-summary\[data-state='closed'\] \.section-subtitle__text/,
		);

		expect(cardRule).toMatch(/padding-block:\s*0;/);
		expect(headingRule).toMatch(/margin:\s*0;/);
		expect(headerRule).toMatch(/display:\s*grid;/);
		expect(headerRule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+1\.25rem;/);
		expect(headerRule).toMatch(/align-items:\s*start;/);
		expect(headerRule).toMatch(/column-gap:\s*\.625rem;/);
		expect(headerRule).toMatch(/min-height:\s*44px;/);
		expect(headerRule).toMatch(/padding:\s*1rem\s+1\.5rem\s+\.375rem;/);
		expect(markedHeaderRule).toMatch(
			/grid-template-columns:\s*1\.75rem\s+minmax\(0,\s*1fr\)\s+1\.25rem;/,
		);
		expect(titleOnlyRule).toMatch(/padding-block:\s*1rem;/);
		expect(markRule).toMatch(/display:\s*inline-flex;/);
		expect(markRule).toMatch(/width:\s*1\.75rem;/);
		expect(markRule).toMatch(/min-height:\s*1\.75rem;/);
		expect(markRule).toMatch(/align-items:\s*center;/);
		expect(markRule).toMatch(/justify-content:\s*center;/);
		expect(chevronRule).toMatch(/margin-block-start:\s*\.25rem;/);
		expect(titleRule).toMatch(/min-width:\s*0;/);
		expect(titleRule).toMatch(/line-height:\s*1\.4;/);
		expect(titleRule).toMatch(/text-wrap:\s*balance;/);
		expect(subtitleRule).toMatch(/display:\s*grid;/);
		expect(subtitleRule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+1\.25rem;/);
		expect(subtitleRule).toMatch(/column-gap:\s*0?\.625rem;/);
		expect(subtitleRule).toMatch(/margin:\s*0;/);
		expect(subtitleRule).toMatch(/padding:\s*0\s+1\.5rem\s+1rem;/);
		expect(subtitleRule).toMatch(/color:\s*var\(--foreground\);/);
		expect(subtitleRule).toMatch(/font-family:\s*var\(--font-body\);/);
		expect(subtitleRule).toMatch(/font-size:\s*var\(--text-small\);/);
		expect(subtitleRule).toMatch(/line-height:\s*1\.6;/);
		expect(markedSubtitleRule).toMatch(
			/grid-template-columns:\s*1\.75rem\s+minmax\(0,\s*1fr\)\s+1\.25rem;/,
		);
		expect(subtitleTextRule).toMatch(/grid-column:\s*1;/);
		expect(subtitleTextRule).toMatch(/min-width:\s*0;/);
		expect(subtitleTextRule).toMatch(/overflow-wrap:\s*anywhere;/);
		expect(subtitleTextRule).toMatch(/text-wrap:\s*pretty;/);
		expect(markedSubtitleTextRule).toMatch(/grid-column:\s*2;/);
		expect(closedTextRule).toMatch(/display:\s*-webkit-box;/);
		expect(closedTextRule).toMatch(/overflow:\s*hidden;/);
		expect(closedTextRule).toMatch(/-webkit-box-orient:\s*vertical;/);
		expect(closedTextRule).toMatch(/-webkit-line-clamp:\s*2;/);
		expect(closedTextRule).toMatch(/(?:^|\n)\s*line-clamp:\s*2;/);
		expect(source).not.toMatch(
			/\.section-subtitle(?:--article-summary|__text)[^{]*\{[^}]*transition\s*:/s,
		);
	});

	it('characterizes the unchanged content and chevron motion contracts', () => {
		const contentSource = readFileSync(
			resolve(
				process.cwd(),
				'src/lib/components/ui/collapsible/collapsible-content.svelte',
			),
			'utf-8',
		);
		const chevronSource = readFileSync(
			resolve(process.cwd(), 'src/lib/components/brand/ChevronToggle.svelte'),
			'utf-8',
		);
		const collapsedRule = cssRule(contentSource, /\.collapsible-content/);
		const openRule = cssRule(contentSource, /\.collapsible-content\[data-state='open'\]/);
		const chevronMotionRule = cssRule(chevronSource, /\.chevron/);

		expect(collapsedRule).toMatch(/display:\s*grid;/);
		expect(collapsedRule).toMatch(/grid-template-rows:\s*0fr;/);
		expect(collapsedRule).toMatch(/opacity:\s*0;/);
		expect(collapsedRule).toMatch(
			/grid-template-rows\s+var\(--duration-slow\)\s+var\(--ease-default\)/,
		);
		expect(collapsedRule).toMatch(
			/opacity\s+var\(--duration-slow\)\s+var\(--ease-default\)/,
		);
		expect(openRule).toMatch(/grid-template-rows:\s*1fr;/);
		expect(openRule).toMatch(/opacity:\s*1;/);
		expect(contentSource).toMatch(
			/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.collapsible-content\s*\{\s*transition:\s*none;/,
		);
		expect(chevronMotionRule).toMatch(
			/transform\s+var\(--duration-normal\)\s+var\(--ease-default\)/,
		);
		expect(chevronSource).toMatch(
			/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.chevron\s*\{\s*transition:\s*none;/,
		);
	});
});

describe('CollapsibleSection - whole-card toggling', () => {
	it('toggles from a click on the non-interactive card body', async () => {
		const { container, getByTestId } = render(CollapsibleSection, {
			props: { title: 'Card', open: true, children: bodyContent },
		});
		const body = container.querySelector('.section-body');
		expect(body?.getAttribute('data-state')).toBe('open');

		await fireEvent.click(getByTestId('body-text'));
		expect(body?.getAttribute('data-state')).toBe('closed');

		const card = container.querySelector('[data-slot="card"]') as HTMLElement;
		await fireEvent.click(card);
		expect(body?.getAttribute('data-state')).toBe('open');
	});

	it('clicks originating from interactive children never toggle', async () => {
		const { container, getByTestId } = render(CollapsibleSection, {
			props: { title: 'Card', open: true, children: bodyContent },
		});
		const body = container.querySelector('.section-body');
		expect(body?.getAttribute('data-state')).toBe('open');

		await fireEvent.click(getByTestId('body-button'));
		expect(body?.getAttribute('data-state')).toBe('open');

		await fireEvent.click(getByTestId('body-rolebutton'));
		expect(body?.getAttribute('data-state')).toBe('open');
	});

	it('header click toggles exactly once (card handler must not re-toggle it)', async () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Card', open: true, children: bodyContent },
		});
		const header = container.querySelector('button.section-header') as HTMLElement;
		const body = container.querySelector('.section-body');

		await fireEvent.click(header);
		expect(body?.getAttribute('data-state')).toBe('closed');
		await fireEvent.click(header);
		expect(body?.getAttribute('data-state')).toBe('open');
	});

	it('keeps the header as the real aria-expanded button; the card claims no role', async () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Card', open: true, children: bodyContent },
		});
		const header = container.querySelector('button.section-header') as HTMLElement;
		expect(header).toBeTruthy();
		expect(header.getAttribute('aria-expanded')).toBe('true');

		await fireEvent.click(header);
		expect(header.getAttribute('aria-expanded')).toBe('false');

		const card = container.querySelector('[data-slot="card"]') as HTMLElement;
		expect(card.getAttribute('role')).toBeNull();
		expect(card.classList.contains('section-card--toggleable')).toBe(true);
	});

	it('non-collapsible cards opt out of the whole-card affordance', () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Static', open: true, collapsible: false, children: bodyContent },
		});
		const card = container.querySelector('[data-slot="card"]') as HTMLElement;
		expect(card.classList.contains('section-card--toggleable')).toBe(false);
	});
});

describe('CollapsibleSection - mount-time bulk mode', () => {
	// Data-gated cards mount AFTER the article's mount-time bulk signal bumped the
	// counters, so the edge-detectors never see a change. `bulkCollapsed` carries
	// the page's current bulk mode; on mount it is authoritative over the `open`
	// default and any restored session choice (state model #8/#10).

	it('adopts a collapsed bulk mode when mounting after the close signal fired', () => {
		const { container } = render(CollapsibleSection, {
			props: { title: 'Late', open: true, closeSignal: 1, openSignal: 0, bulkCollapsed: true },
		});
		expect(container.querySelector('.section-body')?.getAttribute('data-state')).toBe('closed');
	});

	it('reopens a stale session CLOSE choice when the mount-time bulk mode is expanded', () => {
		sessionStorage.setItem('transit.persisted:late-card', 'false');
		try {
			const { container } = render(CollapsibleSection, {
				props: {
					title: 'Late',
					open: true,
					sectionKey: 'late-card',
					closeSignal: 0,
					openSignal: 1,
					bulkCollapsed: false,
				},
			});
			expect(container.querySelector('.section-body')?.getAttribute('data-state')).toBe('open');
		} finally {
			sessionStorage.removeItem('transit.persisted:late-card');
		}
	});

	it('stays session-restored when no bulk mode is wired (signal-inert default)', () => {
		sessionStorage.setItem('transit.persisted:late-card-inert', 'false');
		try {
			const { container } = render(CollapsibleSection, {
				props: { title: 'Late', open: true, sectionKey: 'late-card-inert' },
			});
			expect(container.querySelector('.section-body')?.getAttribute('data-state')).toBe('closed');
		} finally {
			sessionStorage.removeItem('transit.persisted:late-card-inert');
		}
	});

	it('uses bulkCollapsed only at mount and preserves later manual state', async () => {
		try {
			const { container, rerender } = render(CollapsibleSection, {
				props: {
					title: 'Late',
					open: true,
					sectionKey: 'late-card-one-shot',
					bulkCollapsed: true,
				},
			});
			const header = container.querySelector('button.section-header') as HTMLElement;
			const body = container.querySelector('.section-body');
			expect(body).toHaveAttribute('data-state', 'closed');

			await fireEvent.click(header);
			await fireEvent.click(header);
			expect(body).toHaveAttribute('data-state', 'closed');

			await rerender({
				title: 'Late',
				open: true,
				sectionKey: 'late-card-one-shot',
				bulkCollapsed: false,
			});
			expect(body).toHaveAttribute('data-state', 'closed');
		} finally {
			sessionStorage.removeItem('transit.persisted:late-card-one-shot');
		}
	});
});
