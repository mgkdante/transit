import { describe, expect, it } from 'vitest';

import {
	BUS_FILL_TOKEN,
	BUS_HALO_TOKEN,
	BUS_ICON,
	HEADING_FILL_TOKEN,
	HEADING_HALO_TOKEN,
	HEADING_ICON,
	STOP_FILL_TOKEN,
	STOP_HALO_TOKEN,
	STOP_ICON,
} from './vehicleSprites';

describe('vehicle sprite palette contract', () => {
	it('keeps buses orange while stops use the dedicated map-stop fill with the same outline token as buses', () => {
		expect(BUS_FILL_TOKEN).toBe('var(--primary)');
		expect(BUS_HALO_TOKEN).toBe('var(--background)');
		expect(STOP_FILL_TOKEN).toBe('var(--map-stop-fill)');
		expect(STOP_HALO_TOKEN).toBe(BUS_HALO_TOKEN);
		expect(STOP_FILL_TOKEN).not.toBe(BUS_FILL_TOKEN);
	});

	it('paints the directional chevron with a neutral foreground tick so it reads on any bus colour', () => {
		// ONE chevron sprite, rotated per-feature by the layer — neutral so it
		// contrasts on every (orange / status / occupancy) bus fill.
		expect(HEADING_FILL_TOKEN).toBe('var(--foreground)');
		expect(HEADING_HALO_TOKEN).toBe(BUS_HALO_TOKEN);
	});

	it('keeps a single consolidated bus sprite plus a stop pin and a heading chevron with distinct ids', () => {
		// One bus glyph (no directional variants), one stop pin, one chevron.
		const ids = [BUS_ICON, STOP_ICON, HEADING_ICON];
		expect(new Set(ids).size).toBe(ids.length);
		expect(BUS_ICON).toBe('veh-bus');
		expect(STOP_ICON).toBe('veh-stop');
		expect(HEADING_ICON).toBe('veh-heading');
	});
});
