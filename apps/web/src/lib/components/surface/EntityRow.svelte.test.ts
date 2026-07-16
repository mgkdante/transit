import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import EntityRow from './EntityRow.svelte';

describe('EntityRow base', () => {
	it('links a line target to its detail page with title + subtitle', () => {
		render(EntityRow, {
			props: {
				target: { kind: 'line', id: '161' },
				locale: 'en',
				glyph: '═',
				title: '161',
				subtitle: 'Van Horne',
			},
		});
		const link = screen.getByRole('link', { name: /161 Van Horne/i });
		expect(link).toHaveAttribute('href', '/lines/161');
		expect(link).toHaveAttribute('data-sveltekit-preload-data', 'hover');
		expect(link).toHaveAttribute('data-slot', 'entity-row');
		expect(link).toHaveClass('entity-row', 'tap-press');
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('renders a choice as a native button and invokes its action once', async () => {
		const onSelect = vi.fn();

		render(EntityRow, {
			props: {
				onSelect,
				ariaLabel: 'Browse stops for line 80',
				glyph: '═',
				title: '80',
				subtitle: 'Avenue du Parc',
			},
		});

		const choice = screen.getByRole('button', { name: 'Browse stops for line 80' });
		expect(choice).toHaveAttribute('type', 'button');
		expect(choice).toHaveAttribute('data-slot', 'entity-row');
		expect(choice).toHaveClass('entity-row', 'tap-press');
		expect(choice).not.toHaveAttribute('href');

		await fireEvent.click(choice);
		expect(onSelect).toHaveBeenCalledTimes(1);
	});
});

describe('EntityRow brand colour swatch (guarded dynamic colour)', () => {
	it('renders the swatch with the guarded hue inline when a colour is passed', () => {
		const { container } = render(EntityRow, {
			props: {
				target: { kind: 'line', id: '1' },
				locale: 'en',
				title: '1',
				swatch: '#009ee0',
			},
		});
		const swatch = container.querySelector('.entity-row-swatch') as HTMLElement | null;
		expect(swatch).not.toBeNull();
		expect(swatch?.getAttribute('style')).toContain('#009ee0');
	});

	it('renders NO swatch when the colour is null (no fabricated default hue)', () => {
		const { container } = render(EntityRow, {
			props: { target: { kind: 'line', id: '1' }, locale: 'en', title: '1', swatch: null },
		});
		expect(container.querySelector('.entity-row-swatch')).toBeNull();
	});
});

describe('EntityRow mode tag', () => {
	it('renders the mode tag chip beside the title', () => {
		render(EntityRow, {
			props: { target: { kind: 'line', id: '1' }, locale: 'en', title: '1', tag: 'Métro' },
		});
		expect(screen.getByText('Métro')).toBeInTheDocument();
	});
});

describe('EntityRow meta slot', () => {
	it('renders metaSlot content in place of the plain meta string', () => {
		const metaSlot = createRawSnippet(() => ({
			render: () => `<span data-testid="meta-content">badge</span>`,
		}));
		render(EntityRow, {
			props: {
				target: { kind: 'stop', id: 's1' },
				locale: 'en',
				title: 'Stop',
				meta: 'IGNORED',
				metaSlot,
			},
		});
		expect(screen.getByTestId('meta-content')).toBeInTheDocument();
		// The plain meta string is superseded by the slot.
		expect(screen.queryByText('IGNORED')).toBeNull();
	});
});
