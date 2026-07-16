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
});
