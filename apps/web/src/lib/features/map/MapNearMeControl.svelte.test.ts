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
		expect(s).toContain('onsuggestion(result)');
		expect(s).not.toMatch(/suggestionSessionToken|Place-Details/u);
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
			/@media \(max-width: 1023\.98px\)[\s\S]*\.map-near-panel\s*\{[\s\S]*width:\s*min\(24rem/,
		);
	});

	it('extends the compact amber toggle through the complete <1024 band', () => {
		const s = source();
		const compact = s.match(/@media \(max-width: 1023\.98px\)\s*\{([\s\S]*?)\n\t\}/)?.[1] ?? '';

		expect(compact).toMatch(/\.map-near-toggle\s*\{[\s\S]*?width:\s*2\.75rem/);
		expect(compact).toMatch(/\.map-near-toggle\s*\{[\s\S]*?height:\s*2\.75rem/);
		expect(compact).toMatch(/\.map-near-toggle span\s*\{[\s\S]*?display:\s*none/);
		expect(s).not.toContain('@media (max-width: 768px)');
	});

	it('contains no inactive Google provider session or attribution surface', () => {
		const s = source();

		expect(s).not.toMatch(/Google|sessionToken|placeId/u);
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
