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

describe('near-me address search', () => {
	it('debounces, caches, selects and dismisses address suggestions', async () => {
		vi.useFakeTimers();
		const results: GeocodeSuggestion[] = [
			{ label: '123 Sherbrooke', lat: 45.5, lon: -73.6, source: 'geo_ca', precision: 'address' },
			{ label: '125 Sherbrooke', lat: 45.51, lon: -73.61, source: 'geo_ca', precision: 'address' },
		];
		const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results }) });
		vi.stubGlobal('fetch', fetch);
		const onsuggestion = vi.fn();
		const { getByRole, queryByRole, rerender } = render(MapNearMeControl, {
			props: {
				open: true,
				locale: 'en',
				copy: copy.en,
				onuselocation: vi.fn(),
				onsearch: vi.fn(),
				onsuggestion,
				onstopselect: vi.fn(),
				onclear: vi.fn(),
			},
		});
		const input = getByRole('combobox');
		expect(queryByRole('button', { name: copy.en.nearMeClear })).not.toBeInTheDocument();
		await fireEvent.input(input, { target: { value: '123 Sherbrooke' } });
		expect(fetch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(121);
		await tick();
		expect(fetch).toHaveBeenCalledTimes(1);
		const url = new URL(fetch.mock.calls[0][0], 'https://example.test');
		expect(url.searchParams.get('suggest')).toBe('1');
		expect(url.searchParams.get('limit')).toBe('4');
		const options = within(getByRole('listbox')).getAllByRole('option');
		expect(options).toHaveLength(2);
		expect(options[0]).toHaveAccessibleName(/123 Sherbrooke/);
		expect(options[1]).toHaveAccessibleName(/125 Sherbrooke/);
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(queryByRole('listbox')).not.toBeInTheDocument();
		await fireEvent.focus(input);
		expect(getByRole('listbox')).toBeInTheDocument();
		await fireEvent.pointerDown(document.body);
		expect(queryByRole('listbox')).not.toBeInTheDocument();
		await fireEvent.input(input, { target: { value: '' } });
		await fireEvent.input(input, { target: { value: '123 Sherbrooke' } });
		await vi.advanceTimersByTimeAsync(121);
		expect(fetch).toHaveBeenCalledTimes(1);
		await fireEvent.click(getByRole('option', { name: /125 Sherbrooke/ }));
		expect(onsuggestion).toHaveBeenCalledExactlyOnceWith(results[1]);
		await rerender({ origin: results[1] });
		expect(getByRole('button', { name: copy.en.nearMeClear })).toBeInTheDocument();
	});
});

it.each([
	[
		'en',
		'Stops near me',
		'Your searches are sent to our server and the Government of Canada Geo.ca service.',
	],
	[
		'fr',
		'Arrêts près de moi',
		'Vos recherches sont envoyées à notre serveur et au service Géo.ca du gouvernement du Canada.',
	],
] as const)(
	'renders the %s collection notice directly below the near-me search form',
	async (locale, toggleLabel, expectedNotice) => {
		const { getByRole, getByText } = render(MapNearMeControl, {
			props: {
				locale,
				copy: copy[locale],
				onuselocation: () => {},
				onsearch: () => {},
				onsuggestion: () => {},
				onstopselect: () => {},
				onclear: () => {},
			},
		});

		await fireEvent.click(getByRole('button', { name: toggleLabel }));

		const notice = getByText(expectedNotice);
		expect(notice.previousElementSibling?.tagName).toBe('FORM');
		expect(notice).toHaveAttribute('id', 'map-near-collection-notice');
		expect(getByRole('combobox')).toHaveAttribute('aria-describedby', 'map-near-collection-notice');
	},
);
