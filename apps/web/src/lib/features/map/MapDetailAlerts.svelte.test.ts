import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import MapDetailAlerts from './MapDetailAlerts.svelte';
import { MAP_SELECTION_DETAIL_COPY } from './mapSelectionDetail.copy';

describe('MapDetailAlerts', () => {
	it('renders an empty alert list as the shared healthy-zero notice', () => {
		render(MapDetailAlerts, {
			props: { alerts: [], locale: 'en', t: MAP_SELECTION_DETAIL_COPY.en },
		});

		const notice = screen
			.getByText('No alerts attached')
			.closest('[data-component="state-notice"]');
		expect(notice).toHaveAttribute('data-presentation', 'silo');
		expect(notice).toHaveAttribute('data-tone', 'positive');
	});

	it('renders unavailable alert data as a neutral notice, never a healthy zero', () => {
		render(MapDetailAlerts, {
			props: { alerts: null, locale: 'en', t: MAP_SELECTION_DETAIL_COPY.en },
		});

		const notice = screen
			.getByText('Alert data unavailable')
			.closest('[data-component="state-notice"]');
		expect(notice).toHaveAttribute('data-presentation', 'silo');
		expect(notice).toHaveAttribute('data-tone', 'neutral');
		expect(screen.queryByText('No alerts attached')).not.toBeInTheDocument();
	});
});
