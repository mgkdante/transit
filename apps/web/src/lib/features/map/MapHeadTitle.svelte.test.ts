import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { copy as MAP_COPY } from './map.copy';
import { stampFixture } from '#lib/v1/live/__fixtures__/presentation.ts';
import MapHeadTitle from './MapHeadTitle.svelte';

describe('MapHeadTitle', () => {
	it.each(['en', 'fr'] as const)('renders the %s title without an eyebrow', (locale) => {
		const { heading, headingLead: lead } = MAP_COPY[locale];
		const { container } = render(MapHeadTitle, {
			props: { locale, heading, lead, presentation: stampFixture() },
		});
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
			`${MAP_COPY[locale].heading}.`,
		);
		expect(container.querySelector('.map-kicker')).not.toBeInTheDocument();
		const report = container.querySelector('[data-placement="head"]');
		expect(report).toBeInTheDocument();
		expect(
			report!.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			screen.getByRole('heading', { level: 1 }).compareDocumentPosition(screen.getByText(lead)) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});
});
