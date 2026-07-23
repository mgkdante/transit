import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TRANSIT_ANALYTICS_PRESET } from './preset';

const PRESET_PATH = new URL('./preset.ts', import.meta.url);

describe('Transit analytics preset', () => {
	it('exists as the only product-owned analytics configuration', () => {
		expect(existsSync(PRESET_PATH)).toBe(true);
		expect(readFileSync(PRESET_PATH, 'utf-8')).toMatch(
			/import\s+\{\s*defineAnalyticsPreset\s*\}\s+from\s+['"]@yesid\/analytics\/config['"]/,
		);
	});

	it('defines the inert Transit domain and storage-key contract', () => {
		expect(TRANSIT_ANALYTICS_PRESET).toEqual({
			domain: 'transit.yesid.dev',
			events: [],
			storageKeys: {
				consent: 'transit:analytics-consent:v1',
				preferencesOpen: 'transit:analytics-preferences-open:v1',
				denialSafety: 'transit:analytics-denial-safety:v1',
				storageProbe: 'transit:analytics-storage-probe:v1',
			},
		});
	});

	it('does not mount analytics or import runtime concerns', () => {
		const source = readFileSync(PRESET_PATH, 'utf-8');

		expect(source).not.toMatch(
			/from\s+['"]@yesid\/analytics\/(?:client|consent|plausible|policy)['"]/,
		);
		expect(source).not.toMatch(/\b(?:fetch|localStorage|sessionStorage|document|window)\b/);
	});
});
