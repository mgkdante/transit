import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import StackedBar from './StackedBar.svelte';

describe('StackedBar selection', () => {
	const segments = [
		{ code: 'on_time', value: 8, label: 'On-time' },
		{ code: 'late', value: 2, label: 'Late' },
	] as const;

	it('emits the selected segment on click without changing data colours', async () => {
		const onSelect = vi.fn();
		render(StackedBar, {
			props: { scale: 'status', segments: [...segments], interactive: true, onSelect },
		});

		await fireEvent.click(screen.getByRole('img', { name: 'Late: 20%' }));

		expect(onSelect).toHaveBeenCalledExactlyOnceWith('late');
		expect(screen.getByRole('img', { name: 'Late: 20%' })).toHaveAttribute(
			'fill',
			'var(--dataviz-status-late)',
		);
	});

	it('emits the selected segment on Enter for keyboard drilldown', async () => {
		const onSelect = vi.fn();
		render(StackedBar, {
			props: { scale: 'status', segments: [...segments], interactive: true, onSelect },
		});

		await fireEvent.keyDown(screen.getByRole('img', { name: 'Late: 20%' }), { key: 'Enter' });

		expect(onSelect).toHaveBeenCalledExactlyOnceWith('late');
	});
});

describe('StackedBar thickness', () => {
	const segments = [
		{ code: 'on_time', value: 8, label: 'On-time' },
		{ code: 'late', value: 2, label: 'Late' },
	] as const;

	it('defaults to the md thickness (10px svg height)', () => {
		const { container } = render(StackedBar, {
			props: { scale: 'status', segments: [...segments] },
		});
		expect(container.querySelector('svg')?.getAttribute('height')).toBe('10');
	});

	it('renders the slim sm thickness (8px svg height) when size="sm"', () => {
		const { container } = render(StackedBar, {
			props: { scale: 'status', segments: [...segments], size: 'sm' },
		});
		expect(container.querySelector('svg')?.getAttribute('height')).toBe('8');
	});

	it('renders per-segment % shares in the legend', () => {
		render(StackedBar, {
			props: { scale: 'status', segments: [...segments], legend: true, label: 'Status mix' },
		});
		expect(screen.getByText('80%')).toBeInTheDocument();
		expect(screen.getByText('20%')).toBeInTheDocument();
	});
});
