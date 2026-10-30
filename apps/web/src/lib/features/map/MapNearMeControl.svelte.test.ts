import { fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import type { GeocodeSuggestion } from '$lib/geocode/types';
import MapNearMeControl from './MapNearMeControl.svelte';
import { copy } from './map.copy';

vi.mock('$lib/v1/boot', () => ({ getV1Context: () => ({ manifest: { provider: 'stm' } }) }));

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const handlers = () => ({
	onuselocation: vi.fn(),
	onsearch: vi.fn(),
	onsuggestion: vi.fn(),
	onstopselect: vi.fn(),
	onclear: vi.fn(),
});

describe('near-me address search', () => {
	it('debounces, caches, selects and dismisses address suggestions', async () => {
		vi.useFakeTimers();
		const results: GeocodeSuggestion[] = [
			{ label: '123 Sherbrooke', lat: 45.5, lon: -73.6, source: 'geo_ca', precision: 'address' },
			{ label: '125 Sherbrooke', lat: 45.51, lon: -73.61, source: 'geo_ca', precision: 'address' },
		];
		const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results }) });
		vi.stubGlobal('fetch', fetch);
		const props = { locale: 'en' as const, copy: copy.en, ...handlers() };
		const { getByRole, queryByRole, rerender } = render(MapNearMeControl, { props });
		await fireEvent.click(getByRole('button', { name: copy.en.nearMe }));
		const input = getByRole('combobox');
		expect(queryByRole('button', { name: copy.en.nearMeClear })).not.toBeInTheDocument();

		await fireEvent.input(input, { target: { value: results[0].label } });
		expect(fetch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(121);
		await tick();
		expect(fetch).toHaveBeenCalledTimes(1);
		const url = new URL(fetch.mock.calls[0][0], 'https://example.test');
		expect(url.searchParams.get('suggest')).toBe('1');
		expect(url.searchParams.get('limit')).toBe('4');
		const options = within(getByRole('listbox')).getAllByRole('option');
		expect(options).toHaveLength(results.length);
		options.forEach((option, index) =>
			expect(option).toHaveAccessibleName(new RegExp(results[index].label)),
		);

		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(queryByRole('listbox')).not.toBeInTheDocument();
		await fireEvent.focus(input);
		expect(getByRole('listbox')).toBeInTheDocument();
		await fireEvent.pointerDown(document.body);
		expect(queryByRole('listbox')).not.toBeInTheDocument();

		await fireEvent.input(input, { target: { value: '' } });
		await fireEvent.input(input, { target: { value: results[0].label } });
		await vi.advanceTimersByTimeAsync(121);
		expect(fetch).toHaveBeenCalledTimes(1);
		await fireEvent.click(within(getByRole('listbox')).getAllByRole('option')[1]);
		expect(props.onsuggestion).toHaveBeenCalledExactlyOnceWith(results[1]);
		await rerender({ origin: results[1] });
		expect(getByRole('button', { name: copy.en.nearMeClear })).toBeInTheDocument();
	});
});

it.each(['en', 'fr'] as const)(
	'describes the %s address search with its collection notice',
	async (locale) => {
		const { getByRole, getByText } = render(MapNearMeControl, {
			props: { locale, copy: copy[locale], ...handlers() },
		});

		await fireEvent.click(getByRole('button', { name: copy[locale].nearMe }));

		expect(getByText(copy[locale].nearMeCollectionNotice)).toBeVisible();
		expect(getByRole('combobox')).toHaveAccessibleDescription(copy[locale].nearMeCollectionNotice);
	},
);
