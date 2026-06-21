import { fireEvent, render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import RightPanel from './RightPanel.svelte';

describe('RightPanel', () => {
	it('collapses horizontally without closing the selected surface', async () => {
		const onclose = vi.fn();
		const { container, getByRole, queryByText } = render(RightPanel, {
			props: { locale: 'en', title: 'Route 161', surfaceKey: 'route:161', onclose },
		});

		expect(queryByText('Route 161')).toBeInTheDocument();
		expect(queryByText('Select something to inspect')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="right-panel"]')).toHaveAttribute(
			'data-open',
			'true',
		);

		await fireEvent.click(getByRole('button', { name: 'Collapse panel' }));

		expect(onclose).not.toHaveBeenCalled();
		expect(container.querySelector('[data-slot="right-panel"]')).toHaveAttribute(
			'data-open',
			'false',
		);
		expect(queryByText('Route 161')).not.toBeInTheDocument();
		expect(queryByText('Select something to inspect')).not.toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Expand panel' }));

		expect(queryByText('Route 161')).toBeInTheDocument();
		expect(queryByText('Select something to inspect')).toBeInTheDocument();
	});

	it('uses the same width-only collapse model as the filter rail', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/shell/RightPanel.svelte'),
			'utf-8',
		);

		expect(source).not.toMatch(/\.right-panel\[data-open='false'\]\s*\{[^}]*padding:/);
		expect(source).not.toMatch(/transition:\s*[^;{}]*padding/);
		expect(source).toMatch(/\.right-panel\[data-open='false'\]\s*\{\s*width:\s*3\.7rem;\s*\}/);
	});

	// B1 — inside a resizable pane the EXPANDED panel fills the pane (width:100%),
	// but the COLLAPSED panel must shrink to the icon-strip rem floor (3.7rem)
	// instead of filling 100% — otherwise the "collapsed" rail is as wide as the
	// pane percent (the operator's too-wide-strip complaint).
	it('shrinks the collapsed resizable panel to the icon-strip rem floor (B1)', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/shell/RightPanel.svelte'),
			'utf-8',
		);

		// Expanded resizable still fills the pane.
		expect(source).toMatch(/\.right-panel\[data-resizable='true'\]\s*\{\s*width:\s*100%;/);
		// Collapsed resizable shrinks to 3.7rem, NOT 100%.
		const collapsedResizable =
			source.match(
				/\.right-panel\[data-resizable='true'\]\[data-open='false'\]\s*\{[\s\S]*?\}/,
			)?.[0] ?? '';
		expect(collapsedResizable).toContain('width: 3.7rem');
		expect(collapsedResizable).not.toContain('width: 100%');
		// The dead combined selector that forced collapsed back to 100% is gone.
		expect(source).not.toMatch(
			/\.right-panel\[data-resizable='true'\],\s*\.right-panel\[data-resizable='true'\]\[data-open='false'\]/,
		);
	});

	it('shows a back action only when the detail stack has history', async () => {
		const onback = vi.fn();
		const { rerender, getByRole, queryByRole } = render(RightPanel, {
			props: {
				locale: 'en',
				title: 'Stop 52618',
				surfaceKey: 'stop:52618',
				canGoBack: false,
				onback,
			},
		});

		expect(queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

		await rerender({
			locale: 'en',
			title: 'Route 161',
			surfaceKey: 'route:161',
			canGoBack: true,
			onback,
		});
		await fireEvent.click(getByRole('button', { name: 'Back' }));

		expect(onback).toHaveBeenCalledOnce();
	});

	it('can be hosted inside a resizable pane with externally controlled collapse', async () => {
		const ontogglecollapse = vi.fn();
		const { container, getByRole, queryByText } = render(RightPanel, {
			props: {
				locale: 'en',
				title: 'Route 161',
				surfaceKey: 'route:161',
				resizable: true,
				collapsed: true,
				ontogglecollapse,
			},
		});

		const panel = container.querySelector('[data-slot="right-panel"]');
		expect(panel).toHaveAttribute('data-resizable', 'true');
		expect(panel).toHaveAttribute('data-open', 'false');
		expect(queryByText('Route 161')).not.toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Expand panel' }));

		expect(ontogglecollapse).toHaveBeenCalledOnce();
	});
});
