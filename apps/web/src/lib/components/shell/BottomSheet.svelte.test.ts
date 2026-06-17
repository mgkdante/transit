import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import BottomSheet from './BottomSheet.svelte';

describe('BottomSheet', () => {
	it('shows a back action only when mobile detail history exists', async () => {
		const onback = vi.fn();
		const { rerender, getByRole, queryByRole } = render(BottomSheet, {
			props: {
				open: true,
				locale: 'en',
				title: 'Stop 52618',
				surfaceKey: 'stop:52618',
				canGoBack: false,
				onback,
			},
		});

		expect(queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

		await rerender({
			open: true,
			locale: 'en',
			title: 'Route 161',
			surfaceKey: 'route:161',
			canGoBack: true,
			onback,
		});
		await fireEvent.click(getByRole('button', { name: 'Back' }));

		expect(onback).toHaveBeenCalledOnce();
	});
});
