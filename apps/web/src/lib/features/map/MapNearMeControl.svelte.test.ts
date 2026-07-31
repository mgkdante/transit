import { fireEvent, render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import MapNearMeControl from './MapNearMeControl.svelte';
import { copy } from './map.copy';

describe('MapNearMeControl', () => {
	const source = () => {
		try {
			return readFileSync(
				resolve(process.cwd(), 'src/lib/features/map/MapNearMeControl.svelte'),
				'utf-8',
			);
		} catch {
			return '';
		}
	};

	it('fetches debounced Montreal address suggestions while typing', () => {
		const s = source();

		expect(s).toContain('AbortController');
		expect(s).toContain('setTimeout');
		expect(s).toContain('&suggest=1&limit=4');
		expect(s).toContain('shouldSuggestNearMeAddress');
	});

	it('keeps near-me suggestions responsive with a short debounce and local cache', () => {
		const s = source();

		expect(s).toContain('const suggestionCache = new SvelteMap');
		expect(s).toContain('}, 120);');
		expect(s).toContain('suggestionCache.set(cacheKey, results)');
	});

	it('starts address suggestions for numeric street-address prefixes', () => {
		const s = source();

		expect(s).toContain('function isCoordinateQuery');
		expect(s).not.toContain('!/[A-Za-zÀ-ÿ]/.test(trimmed)');
	});

	it('renders address suggestions as selectable combobox options', () => {
		const s = source();

		expect(s).toContain('role="combobox"');
		expect(s).toContain('aria-autocomplete="list"');
		expect(s).toContain('role="listbox"');
		expect(s).toContain('role="option"');
		expect(s).toContain('class="map-near-suggestion"');
		// Hands the active autocomplete session token to the parent (for the
		// Place-Details resolution) BEFORE minting a fresh one.
		expect(s).toContain('const usedToken = suggestionSessionToken');
		expect(s).toContain('onsuggestion(result, usedToken)');
	});

	it('closes address suggestions like a standard autocomplete popover', () => {
		const s = source();

		expect(s).toContain('let suggestionsOpen = $state(false)');
		expect(s).toContain(
			'<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeydown} />',
		);
		expect(s).toContain('function closeSuggestions()');
		expect(s).toContain('function handleWindowPointerDown');
		expect(s).toContain('function handleWindowKeydown');
		expect(s).toContain('lastSelectedSuggestionLabel = result.label');
		expect(s).toContain('inputEl?.blur()');
	});

	it('gives long address suggestions room to wrap on desktop and mobile', () => {
		const s = source();

		expect(s).toMatch(/\.map-near-panel\s*\{[\s\S]*width:\s*min\(28rem/);
		expect(s).toMatch(/\.map-near-suggestions\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
		expect(s).toMatch(/\.map-near-suggestions\s*\{[\s\S]*max-height:\s*min\(18rem/);
		expect(s).toMatch(/\.map-near-suggestion span\s*\{[\s\S]*white-space:\s*normal/);
		expect(s).toMatch(
			/@media \(max-width: 768px\)[\s\S]*\.map-near-panel\s*\{[\s\S]*width:\s*min\(24rem/,
		);
	});

	it('renders Google autocomplete attribution with token-based light and dark styling', () => {
		const s = source();

		expect(s).toContain('showGoogleAttribution');
		expect(s).toContain('map-near-google-attribution');
		expect(s).toContain('Powered by');
		expect(s).toContain('Google');
		expect(s).toMatch(
			/\.map-near-google-attribution\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--card\)/,
		);
		expect(s).toMatch(/\.map-near-google-wordmark\s*\{[\s\S]*font-family:\s*var\(--font-heading\)/);
	});

	it('labels street and neighbourhood suggestions distinctly from generic places', () => {
		const s = source();

		expect(s).toContain("if (precision === 'street')");
		expect(s).toContain("if (precision === 'neighbourhood')");
	});

	it.each([
		[
			'en',
			'Stops near me',
			'Your searches are sent to our server and its geocoding providers (Google, geo.ca).',
		],
		[
			'fr',
			'Arrêts près de moi',
			'Vos recherches sont envoyées à notre serveur et à ses fournisseurs de géocodage (Google, geo.ca).',
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
			expect(notice).toHaveClass('map-near-collection-notice');
			expect(notice.previousElementSibling).toHaveClass('map-near-form');
			expect(notice).toHaveAttribute('id', 'map-near-collection-notice');
			expect(getByRole('combobox')).toHaveAttribute(
				'aria-describedby',
				'map-near-collection-notice',
			);
		},
	);

	it('keeps nearby stop rows wired to the map stop picker', () => {
		const s = source();

		expect(s).toContain('onstopselect(stop)');
		expect(s).toContain('formatDistance(stop.distanceM)');
		expect(s).toContain('class="map-near-stop"');
	});

	it('renders a clear-location action only when a near-me origin is selected', () => {
		const s = source();

		expect(s).toContain('onclear: () => void');
		expect(s).toContain('{t.nearMeClear}');
		expect(s).toContain('onclick={onclear}');
		expect(s).toContain('class="map-near-origin-row"');
	});
});
