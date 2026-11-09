import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { copy as MAP_COPY } from './map.copy';
import { stampFixture } from '#lib/v1/live/__fixtures__/presentation.ts';
import MapHeadTitle from './MapHeadTitle.svelte';

describe('MapHeadTitle', () => {
	it.each(['en', 'fr'] as const)('renders the %s title without an eyebrow', (locale) => {
		const { container } = render(MapHeadTitle, {
			props: { locale, heading: MAP_COPY[locale].heading, presentation: stampFixture() },
		});
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
			`${MAP_COPY[locale].heading}.`,
		);
		expect(container.querySelector('.map-kicker')).not.toBeInTheDocument();
		expect(container.querySelector('[data-placement="head"]')).toBeInTheDocument();
	});
});
