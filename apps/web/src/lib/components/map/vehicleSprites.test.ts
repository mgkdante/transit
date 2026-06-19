import { describe, expect, it } from 'vitest';

import { BUS_FILL_TOKEN, BUS_HALO_TOKEN, STOP_FILL_TOKEN, STOP_HALO_TOKEN } from './vehicleSprites';

describe('vehicle sprite palette contract', () => {
	it('keeps buses orange while stops use the dedicated map-stop fill with the same outline token as buses', () => {
		expect(BUS_FILL_TOKEN).toBe('var(--primary)');
		expect(BUS_HALO_TOKEN).toBe('var(--background)');
		expect(STOP_FILL_TOKEN).toBe('var(--map-stop-fill)');
		expect(STOP_HALO_TOKEN).toBe(BUS_HALO_TOKEN);
		expect(STOP_FILL_TOKEN).not.toBe(BUS_FILL_TOKEN);
	});
});
