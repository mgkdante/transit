import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataRefresh } from '$lib/stores/refresh.svelte';
import RefreshButton from './RefreshButton.svelte';

const mocks = vi.hoisted(() => ({ invalidateAll: vi.fn<() => Promise<void>>() }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({ invalidateAll: mocks.invalidateAll }));

beforeEach(() => {
	mocks.invalidateAll.mockReset();
});
afterEach(cleanup);

describe('RefreshButton action and recovery', () => {
	it.each([
		['en', 'Refresh data', 'Refreshing…'],
		['fr', 'Actualiser les données', 'Actualisation…'],
	] as const)(
		'keeps the %s control focused on refresh intent through a completed refresh',
		async (locale, label, busyLabel) => {
			let finish!: () => void;
			mocks.invalidateAll.mockImplementation(
				() =>
					new Promise<void>((resolve) => {
						finish = resolve;
					}),
			);
			const initialEpoch = dataRefresh.epoch;
			const { container } = render(RefreshButton, { locale });
			const button = screen.getByRole('button', { name: label });
			expect(button).toHaveAttribute('title', label);
			expect(container.querySelector('[data-slot="refresh-readout"]')).toBeNull();
			await fireEvent.click(button);
			await waitFor(() => expect(mocks.invalidateAll).toHaveBeenCalledOnce());
			expect(dataRefresh.epoch).toBe(initialEpoch + 1);
			expect(screen.getByRole('button', { name: busyLabel })).toBeDisabled();
			await dataRefresh.run();
			expect(mocks.invalidateAll).toHaveBeenCalledOnce();
			finish();
			await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled());
			expect(button).toHaveAttribute('title', label);
		},
	);

	it('releases the control after failed invalidation so recovery can be retried', async () => {
		mocks.invalidateAll.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce();
		render(RefreshButton, { locale: 'en' });
		const button = screen.getByRole('button', { name: 'Refresh data' });
		await fireEvent.click(button);
		await waitFor(() => expect(button).toBeEnabled());
		await fireEvent.click(button);
		await waitFor(() => expect(mocks.invalidateAll).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(button).toBeEnabled());
	});
});
