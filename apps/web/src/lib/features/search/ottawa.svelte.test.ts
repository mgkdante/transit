import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Vehicle } from '#lib/v1/index.ts';
import Harness from './__fixtures__/ProviderVehicleHarness.svelte';

describe.each(['en', 'fr'] as const)('vehicle display in %s', (locale) => {
	it.each(['stm', 'octranspo'])(
		'%s keeps canonical link ids and formats display only',
		(provider) => {
			const vehicle: Vehicle = {
				id: 'bus-1',
				updated_utc: '2026-11-09T00:00:00Z' as Vehicle['updated_utc'],
				lat: 45.4,
				lon: -75.7,
				status: 'unknown',
				route: provider === 'stm' ? '161' : '1-373',
				occupancy: null,
			};
			const { container } = render(Harness, { props: { provider, locale, vehicle } });
			const link = screen.getByRole('link');
			expect(link.getAttribute('href')).toContain('bus-1');
			expect(link.getAttribute('href')).toContain(`provider=${provider}`);
			expect(link).toHaveTextContent(provider === 'stm' ? '161' : '1');
			expect(link).not.toHaveTextContent('1-373');
			expect(link).toHaveTextContent(
				provider === 'stm' ? 'Station Berri-UQAM' : 'Rideau / Cumberland',
			);
			expect(container.querySelector('.vehicle-row-crowd')).toBeNull();
		},
	);
});
