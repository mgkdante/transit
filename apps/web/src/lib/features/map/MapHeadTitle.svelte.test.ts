import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { copy as MAP_COPY } from './map.copy';
import MapHeadTitle from './MapHeadTitle.svelte';

const baseProps = {
	locale: 'en' as const,
	kicker: MAP_COPY.en.kicker,
	heading: MAP_COPY.en.heading,
	generatedUtc: '2026-06-15T00:00:00Z',
	ageSeconds: 12,
	isStale: false,
};

describe('MapHeadTitle', () => {
	it('renders the mono kicker overline and the heading with the brand dot', () => {
		const { container } = render(MapHeadTitle, { props: baseProps });

		const head = container.querySelector('.map-head')!;
		expect(head).toBeInTheDocument();
		expect(head.querySelector('.map-kicker')).toHaveTextContent(MAP_COPY.en.kicker);
		const heading = head.querySelector('.map-heading')!;
		expect(heading).toHaveTextContent(MAP_COPY.en.heading);
		expect(heading.querySelector('.map-dot')).toHaveTextContent('.');
		expect(container.querySelector('h1.map-heading')).toBeInTheDocument();
	});

	it('places the head-placement freshness chip inside the kicker row', () => {
		const { container } = render(MapHeadTitle, { props: baseProps });

		const kickerRow = container.querySelector('.map-kicker-row')!;
		const chip = kickerRow.querySelector('[data-placement="head"]');
		expect(chip).toBeInTheDocument();
	});

	it('positions the block as an absolute overlay anchored to the canvas edge', () => {
		const { container } = render(MapHeadTitle, { props: baseProps });

		expect(container.querySelector('.map-overlay.map-head')).toBeInTheDocument();
	});
});
