import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataRefresh } from '#lib/stores/refresh.svelte.ts';
import RefreshButton from './RefreshButton.svelte';
import { refreshMessage, RESULT_VISIBLE_MS } from './refreshResult';
import { recordStamp, type RecordStamp } from '#lib/v1/stamp.ts';

const mocks = vi.hoisted(() => ({
	invalidateAll: vi.fn<() => Promise<void>>(),
	shownRecord: vi.fn(),
}));
vi.mock('#lib/v1/recordStamp.svelte.ts', () => ({ shownRecord: mocks.shownRecord }));
vi.mock('$app/env', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({ invalidateAll: mocks.invalidateAll }));

beforeEach(async () => {
	mocks.shownRecord.mockReturnValue(null);
	mocks.invalidateAll.mockResolvedValue();
	await dataRefresh.run();
	mocks.invalidateAll.mockReset();
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

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
			expect(button).toHaveAttribute('data-slot', 'button');
			expect(button).toHaveClass('size-11');
			expect(button).toHaveAttribute('title', label);
			expect(container.querySelector('[data-slot="refresh-readout"]')).toBeNull();
			expect(container.querySelector('[data-motion="refresh-busy"]')).toBeNull();
			await fireEvent.click(button);
			await waitFor(() => expect(mocks.invalidateAll).toHaveBeenCalledOnce());
			expect(dataRefresh.epoch).toBe(initialEpoch + 1);
			expect(screen.getByRole('button', { name: busyLabel })).toBeDisabled();
			expect(button.querySelector('[data-motion="refresh-busy"]')).toBeInTheDocument();
			const joined = dataRefresh.run();
			expect(mocks.invalidateAll).toHaveBeenCalledOnce();
			finish();
			await joined;
			await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled());
			expect(button).toHaveAttribute('title', label);
			expect(container.querySelector('[data-motion="refresh-busy"]')).toBeNull();
		},
	);

	it('says it could not refresh and names the data still shown', async () => {
		mocks.invalidateAll.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce();
		render(RefreshButton, { locale: 'en' });
		const button = screen.getByRole('button', { name: 'Refresh data' });
		await fireEvent.click(button);
		await waitFor(() => expect(button).toBeEnabled());
		expect(button).toHaveAttribute('aria-label', 'Refresh failed; try again');
		expect(button.querySelector('[data-motion="refresh-busy"]')).toBeNull();
		expect(screen.getByRole('status')).toHaveTextContent(
			refreshMessage(
				{ kind: 'failed', shownAtMs: dataRefresh.lastResult!.shownAtMs },
				'en',
				undefined,
			),
		);
		await fireEvent.click(button);
		await waitFor(() => expect(mocks.invalidateAll).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(button).toBeEnabled());
		expect(button).toHaveAttribute('aria-label', 'Refresh data');
	});
});

it.each(['en', 'fr'] as const)('shows the time after a successful refresh (%s)', async (locale) => {
	mocks.invalidateAll.mockResolvedValue();
	render(RefreshButton, { locale });
	expect(screen.getByRole('status')).toBeEmptyDOMElement();
	const button = screen.getByRole('button');
	button.focus();
	await fireEvent.click(button);
	await waitFor(() =>
		expect(screen.getByRole('status')).toHaveTextContent(
			refreshMessage({ kind: 'updated', atMs: dataRefresh.lastResult!.atMs }, locale, undefined),
		),
	);
	expect(button).toHaveFocus();
	expect(screen.getByRole('status')).not.toHaveAttribute('tabindex');
});
it('hides a success message after eight seconds and keeps the region', async () => {
	vi.useFakeTimers();
	mocks.invalidateAll.mockResolvedValue();
	render(RefreshButton, { locale: 'en' });
	const status = screen.getByRole('status');
	await fireEvent.click(screen.getByRole('button'));
	await vi.advanceTimersByTimeAsync(0);
	expect(status).not.toBeEmptyDOMElement();
	await vi.advanceTimersByTimeAsync(RESULT_VISIBLE_MS);
	expect(status).toBeEmptyDOMElement();
	expect(status).toBeInTheDocument();
});
it('a failure message leaves when newer data arrives', async () => {
	vi.useFakeTimers();
	mocks.invalidateAll.mockRejectedValue(new Error('offline'));
	render(RefreshButton, { locale: 'en' });
	await fireEvent.click(screen.getByRole('button'));
	await vi.advanceTimersByTimeAsync(0);
	await vi.advanceTimersByTimeAsync(RESULT_VISIBLE_MS);
	expect(screen.getByRole('status')).toHaveTextContent(/^Could not refresh/);
	dataRefresh.track(Promise.resolve());
	await vi.advanceTimersByTimeAsync(0);
	expect(screen.getByRole('status')).toBeEmptyDOMElement();
	expect(screen.getByRole('button')).toHaveAccessibleName('Refresh failed; try again');
});
it.each(['Escape', 'pointerdown'])(
	'Escape or a press elsewhere dismisses the message (%s)',
	async (action) => {
		mocks.invalidateAll.mockResolvedValue();
		render(RefreshButton, { locale: 'en' });
		await fireEvent.click(screen.getByRole('button'));
		await waitFor(() => expect(screen.getByRole('status')).not.toBeEmptyDOMElement());
		await fireEvent.pointerDown(screen.getByRole('button'));
		expect(screen.getByRole('status')).not.toBeEmptyDOMElement();
		const target = action === 'Escape' ? screen.getByRole('button') : screen.getByRole('status');
		target.addEventListener(
			action === 'Escape' ? 'keydown' : 'pointerdown',
			(event) => event.stopPropagation(),
			{ once: true },
		);
		if (action === 'Escape') await fireEvent.keyDown(target, { key: 'Escape' });
		else await fireEvent.pointerDown(target);
		expect(screen.getByRole('status')).toBeEmptyDOMElement();
	},
);
it('on a record page, says whether the record changed', async () => {
	let stamp: RecordStamp = {
		...recordStamp({ manifest: null, historyIndex: null }),
		publishedOn: '2026-11-11',
	};
	const page = {
		get stamp() {
			return stamp;
		},
	};
	mocks.shownRecord.mockReturnValue(page);
	mocks.invalidateAll.mockResolvedValue();
	render(RefreshButton, { locale: 'en' });
	await fireEvent.click(screen.getByRole('button'));
	await waitFor(() =>
		expect(screen.getByRole('status')).toHaveTextContent(/The record has not changed since/),
	);
	mocks.invalidateAll.mockImplementation(async () => {
		stamp = { ...stamp, dataThrough: '2026-11-17', publishedOn: '2026-11-18' };
	});
	await fireEvent.click(screen.getByRole('button'));
	await waitFor(() =>
		expect(screen.getByRole('status')).toHaveTextContent(/^Updated\. A new record is published/),
	);
	mocks.invalidateAll.mockImplementation(async () => {
		mocks.shownRecord.mockReturnValue({ stamp });
	});
	await fireEvent.click(screen.getByRole('button'));
	await waitFor(() =>
		expect(screen.getByRole('status')).toHaveTextContent(/^Live data updated at/),
	);
});
