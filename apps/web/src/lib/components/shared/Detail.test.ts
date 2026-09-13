// Detail.test.ts — the lightweight "Show the detail" progressive-disclosure
// expander. Covers the contract every rider-question section depends on: closed
// by default, the trigger is a real aria-expanded button (not a link), the label
// flips on open (with a fallback), and the detail children render in the body.

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Detail from './Detail.svelte';

const body = createRawSnippet(() => ({
	render: () => `<p data-testid="detail-content">Analyst detail</p>`,
}));

describe('Detail', () => {
	it('mounts closed detail only on first opening and retains its state until teardown', async () => {
		const dispose = vi.fn();
		const setup = vi.fn(() => dispose);
		const content = createRawSnippet(() => ({
			render: () => '<input aria-label="Analyst note" value="initial">',
			setup,
		}));
		const view = render(Detail, { props: { label: 'More', children: content } });
		const toggle = view.getByRole('button', { name: 'More' });
		const shell = view.container.querySelector('[data-slot="collapsible-content"]')!;
		const controlledId = toggle.getAttribute('aria-controls');

		expect(controlledId).toBe(shell.id);
		expect(setup).not.toHaveBeenCalled();
		expect(view.queryByLabelText('Analyst note')).toBeNull();
		await fireEvent.click(toggle);
		const input = view.getByLabelText('Analyst note') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'keep my note' } });
		expect(setup).toHaveBeenCalledOnce();
		expect(shell.hasAttribute('inert')).toBe(false);

		await fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(shell.getAttribute('aria-hidden')).toBe('true');
		expect(shell.hasAttribute('inert')).toBe(true);
		expect(view.container.contains(input)).toBe(true);
		expect(dispose).not.toHaveBeenCalled();
		await fireEvent.click(toggle);
		expect(view.getByLabelText('Analyst note')).toBe(input);
		expect(input.value).toBe('keep my note');
		expect(toggle.getAttribute('aria-controls')).toBe(controlledId);
		expect(view.container.querySelector('[data-slot="collapsible-content"]')).toBe(shell);
		expect(setup).toHaveBeenCalledOnce();
		await view.unmount();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it('mounts on a programmatic opening and retains content when the prop closes', async () => {
		const view = render(Detail, { props: { label: 'More', open: false, children: body } });
		expect(view.queryByTestId('detail-content')).toBeNull();
		await view.rerender({ open: true });
		const content = view.getByTestId('detail-content');
		await view.rerender({ open: false });
		expect(view.getByTestId('detail-content')).toBe(content);
		expect(view.getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('false');
	});

	it.each(['Enter', ' '])(
		'opens from the keyboard with %j and retains trigger focus',
		async (key) => {
			const view = render(Detail, { props: { label: 'More', children: body } });
			const toggle = view.getByRole('button', { name: 'More' });
			toggle.focus();
			await fireEvent.keyDown(toggle, { key });
			expect(toggle.getAttribute('aria-expanded')).toBe('true');
			expect(view.getByTestId('detail-content')).toBeTruthy();
			expect(document.activeElement).toBe(toggle);
		},
	);

	it('includes initially open content during SSR without waiting for an effect', async () => {
		const { createServer } = await import('vite');
		const server = await createServer({
			configFile: 'vite.config.ts',
			appType: 'custom',
			logLevel: 'silent',
			optimizeDeps: { noDiscovery: true },
			server: { middlewareMode: true },
		});
		try {
			const { default: ServerDetail } = await server.ssrLoadModule(
				'/src/lib/components/shared/Detail.svelte',
			);
			const { render: renderSsr } = (await server.ssrLoadModule(
				'svelte/server',
			)) as typeof import('svelte/server');
			const { createRawSnippet: createServerSnippet } = (await server.ssrLoadModule(
				'svelte',
			)) as typeof import('svelte');
			for (const open of [false, true]) {
				const children = createServerSnippet(() => ({
					render: () => '<p>Server analyst detail</p>',
				}));
				const html = renderSsr(ServerDetail, { props: { label: 'More', open, children } }).body;
				expect(html.includes('Server analyst detail')).toBe(open);
				expect(html).toContain(`aria-expanded="${open}"`);
				expect(html).toContain('data-slot="collapsible-content"');
			}
		} finally {
			await server.close();
		}
	}, 20_000);

	it('renders the collapsed label and is closed by default', () => {
		const { container, getByText } = render(Detail, {
			props: { label: 'Show the detail', children: body },
		});
		expect(getByText('Show the detail')).toBeTruthy();
		const toggle = container.querySelector('[data-slot="detail-toggle"]');
		expect(toggle?.getAttribute('aria-expanded')).toBe('false');
	});

	it('exposes a real <button> as the disclosure trigger, not a link', () => {
		const { container } = render(Detail, { props: { label: 'More', children: body } });
		const toggle = container.querySelector('button[data-slot="detail-toggle"]');
		expect(toggle).toBeTruthy();
		expect(toggle?.tagName).toBe('BUTTON');
		expect(container.querySelector('a[data-slot="detail-toggle"]')).toBeNull();
	});

	it('opens on click and flips to the open label', async () => {
		const { container, getByText } = render(Detail, {
			props: { label: 'Show the detail', labelOpen: 'Hide the detail', children: body },
		});
		const toggle = container.querySelector('[data-slot="detail-toggle"]') as HTMLElement;
		await fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(getByText('Hide the detail')).toBeTruthy();
	});

	it('falls back to the collapsed label when labelOpen is omitted', async () => {
		const { container, getByText } = render(Detail, {
			props: { label: 'Show the detail', children: body },
		});
		const toggle = container.querySelector('[data-slot="detail-toggle"]') as HTMLElement;
		await fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(getByText('Show the detail')).toBeTruthy();
	});

	it('renders the detail children inside the disclosure body', () => {
		const { getByTestId } = render(Detail, {
			props: { label: 'Show the detail', open: true, children: body },
		});
		expect(getByTestId('detail-content')).toBeTruthy();
	});

	it('respects a bound open=true on first render', () => {
		const { container } = render(Detail, {
			props: { label: 'Show the detail', open: true, children: body },
		});
		const toggle = container.querySelector('[data-slot="detail-toggle"]');
		expect(toggle?.getAttribute('aria-expanded')).toBe('true');
	});
});
