import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import StateNotice from './StateNotice.svelte';

const metadata = createRawSnippet(() => ({
	render: () => '<span data-testid="metadata">Updated 4 min ago</span>',
}));

const action = createRawSnippet(() => ({
	render: () => '<button type="button" data-testid="action">Retry</button>',
}));

describe('StateNotice — shared state presentation chassis', () => {
	it.each(['pill', 'silo', 'card', 'responsive'] as const)(
		'renders the %s presentation without a contrasting top-edge hook',
		(presentation) => {
			const { container, getByText } = render(StateNotice, {
				props: {
					title: 'Nothing to show',
					body: 'No data has been published for this view yet.',
					glyph: '○',
					presentation,
				},
			});

			const root = container.querySelector('[data-slot="state-notice"]');
			expect(root).toHaveAttribute('data-presentation', presentation);
			expect(root).toHaveAttribute('data-tone', 'neutral');
			expect(root).not.toHaveClass('edge-accent-bar');
			expect(root).not.toHaveAttribute('style');
			expect(getByText('Nothing to show')).toBeInTheDocument();
			expect(getByText('No data has been published for this view yet.')).toBeInTheDocument();
		},
	);

	it.each(['neutral', 'positive', 'warning', 'error'] as const)(
		'exposes %s as semantic content tone without changing the frame',
		(tone) => {
			const { container } = render(StateNotice, {
				props: { title: 'Status', glyph: '●', tone },
			});
			const root = container.querySelector('[data-slot="state-notice"]');
			expect(root).toHaveAttribute('data-tone', tone);
			expect(root?.querySelector('[data-slot="state-notice-glyph"]')).toHaveAttribute(
				'aria-hidden',
				'true',
			);
		},
	);

	it('forwards live-region and accessible-label semantics', () => {
		const { container } = render(StateNotice, {
			props: {
				title: 'Contract unreachable',
				body: 'Retry the data source.',
				glyph: '◆',
				role: 'alert',
				ariaLive: 'assertive',
				ariaLabel: 'Contract unreachable, retry the data source',
			},
		});
		const root = container.querySelector('[data-slot="state-notice"]');
		expect(root).toHaveAttribute('role', 'alert');
		expect(root).toHaveAttribute('aria-live', 'assertive');
		expect(root).toHaveAttribute('aria-label', 'Contract unreachable, retry the data source');
	});

	it('renders optional metadata and action regions in a stable order', () => {
		const { container, getByTestId } = render(StateNotice, {
			props: {
				title: 'Data is behind',
				body: 'Showing the last values received.',
				glyph: '▲',
				tone: 'warning',
				meta: metadata,
				action,
			},
		});

		expect(getByTestId('metadata')).toBeInTheDocument();
		expect(getByTestId('action')).toBeInTheDocument();
		expect(
			container.querySelector('[data-slot="state-notice-meta"]')?.nextElementSibling,
		).toHaveAttribute('data-slot', 'state-notice-action');
	});

	it('owns one neutral frame and cannot encode tone as a top stripe or glow', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/edge/StateNotice.svelte'),
			'utf8',
		);

		expect(source).toContain('border: 1px solid var(--border);');
		expect(source).toContain('background: var(--muted);');
		expect(source).toMatch(/\.state-notice--responsive\s*\{[^}]*container-type:\s*inline-size;/s);
		expect(source).not.toMatch(/\.state-notice\s*\{[^}]*container-type:/s);
		expect(source).not.toMatch(/border-(?:top|block-start)\s*:/);
		expect(source).not.toMatch(/box-shadow\s*:/);
		expect(source).not.toMatch(/(?:filter|drop-shadow)\s*:/);
		expect(source).not.toContain('--edge-rule');
	});

	it('owns its wrap policy, intrinsic cap, inherited type voice, and quiet title', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/edge/StateNotice.svelte'),
			'utf8',
		);
		const tokens = readFileSync(resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
		expect(source).toMatch(
			/\.state-notice-title,\s*\.state-notice-body\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s,
		);
		expect(tokens).toMatch(/--measure-absence:\s*34ch;/);
		expect(source).toMatch(
			/\.state-notice-copy\s*\{[^}]*max-inline-size:\s*var\(--measure-absence\);/s,
		);
		expect(source).toMatch(/\.state-notice\s*\{[^}]*font-family:\s*inherit;/s);
		expect(source).toMatch(
			/\.state-notice-title\s*\{[^}]*color:\s*var\(--muted-foreground\);[^}]*font-weight:\s*500;/s,
		);
		expect(source).not.toMatch(
			/\.state-notice-(?:title|body)\s*\{[^}]*(?:overflow:\s*hidden|text-overflow:|white-space:\s*nowrap)/s,
		);
	});

	it('gives row presentation a literal separator and no box chassis', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/edge/StateNotice.svelte'),
			'utf8',
		);

		expect(source).toContain("presentation === 'row'");
		expect(source).toMatch(
			/<span\s+class="state-notice-separator"\s+aria-hidden="true"\s*>\s*·\s*<\/span>/s,
		);
		expect(source).toMatch(
			/\.state-notice--row \.state-notice-surface\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
		);
		expect(source).toMatch(
			/\.state-notice--row \.state-notice-copy\s*\{[^}]*display:\s*inline-block;[^}]*max-inline-size:\s*var\(--measure-absence\);[^}]*font-weight:\s*500;/s,
		);
		expect(source).toMatch(
			/\.state-notice--row \.state-notice-separator\s*\{[^}]*color:\s*inherit;/s,
		);
		expect(source).not.toMatch(/\.state-notice--row[^}]*border-radius:\s*var\(--radius-pill\)/s);
	});

	it('renders a pill separator as text instead of generated flex-sibling content', () => {
		const { container } = render(StateNotice, {
			props: { title: 'No data', body: 'not enough readings yet', presentation: 'pill' },
		});
		const copy = container.querySelector('.state-notice-copy');
		expect(copy?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'No data · not enough readings yet',
		);

		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/edge/StateNotice.svelte'),
			'utf8',
		);
		expect(source).not.toMatch(/\.state-notice--pill \.state-notice-body::before/);
	});
});
