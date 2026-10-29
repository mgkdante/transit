import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import RetainedHistoryUiHarness from './__fixtures__/RetainedHistoryUiHarness.svelte';

afterEach(cleanup);

function harness(): HTMLElement {
	return screen.getByTestId('retained-history-ui');
}

describe('retained-history UI controller', () => {
	it('keeps raw pending wire state, canonical accepted state, and copy reactive', async () => {
		render(RetainedHistoryUiHarness);
		expect(harness()).toHaveAttribute('data-available-dates', '2026-01-10,2026-01-11');

		await fireEvent.click(screen.getByTestId('seed'));
		expect(harness()).toHaveAttribute('data-requested', 'true');
		expect(harness()).toHaveAttribute('data-explicit', 'true');
		expect(harness()).toHaveAttribute('data-request-window', '2026-01-02:2026-01-03');
		expect(harness()).toHaveAttribute('data-wire-from', '2026-01-03');
		expect(harness()).toHaveAttribute('data-wire-to', '2026-01-02');
		expect(harness()).toHaveAttribute('data-live-announcement', 'loading range');

		await fireEvent.click(screen.getByTestId('accept'));
		expect(harness()).toHaveAttribute('data-ready', 'true');
		expect(harness()).toHaveAttribute('data-resolved-window', '2026-01-02:2026-01-03');
		expect(harness()).toHaveAttribute('data-available-dates', '2026-01-01,2026-01-02,2026-01-03');
		expect(harness()).toHaveAttribute('data-wire-from', '2026-01-02');
		expect(harness()).toHaveAttribute('data-wire-to', '2026-01-03');
		expect(harness()).toHaveAttribute('data-coverage', 'coverage [2026-01-01] [2026-01-03]');
		expect(harness()).toHaveAttribute('data-selection', 'selection [2026-01-02] [2026-01-03]');
		expect(harness()).toHaveAttribute('data-live-announcement', 'ready range');
	});

	it('announces each correction once, clears the request, and retains fallback wire support', async () => {
		render(RetainedHistoryUiHarness);
		await fireEvent.click(screen.getByTestId('seed'));
		await fireEvent.click(screen.getByTestId('accept'));
		await fireEvent.click(screen.getByTestId('correct'));

		await waitFor(() => expect(harness()).toHaveAttribute('data-requested', 'false'));
		expect(harness()).toHaveAttribute('data-announcement', 'corrected gap');
		expect(harness()).toHaveAttribute('data-live-announcement', 'corrected gap');
		expect(harness()).toHaveAttribute('data-corrections', '1');
		expect(harness()).toHaveAttribute('data-fallback-from', '2026-01-10');

		await fireEvent.click(screen.getByTestId('fallback'));
		expect(harness()).toHaveAttribute('data-fallback-from', '2026-01-10');
		expect(harness()).toHaveAttribute('data-corrections', '1');
	});
});
