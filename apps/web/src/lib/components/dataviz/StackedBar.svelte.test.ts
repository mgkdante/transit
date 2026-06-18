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
