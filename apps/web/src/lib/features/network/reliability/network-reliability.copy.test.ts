import { expect, it } from 'vitest';
import { providerNetworkReliabilityCopy } from './network-reliability.copy';
it.each([
	['stm', 'en', 'Metro is excluded.', 'O-Train'],
	['stm', 'fr', 'Le métro est exclu.', 'O-Train'],
	['octranspo', 'en', 'O-Train is excluded.', 'Metro'],
	['octranspo', 'fr', 'L’O-Train est exclu.', 'métro'],
] as const)('names the excluded lines for %s in %s', (provider, locale, expected, other) => {
	const copy = providerNetworkReliabilityCopy(locale, provider);
	for (const text of [copy.reporting.caveat, copy.nonResponding.caption]) {
		expect(text).toContain(expected);
		expect(text).not.toContain(other);
		expect(text).not.toContain('{excluded}');
	}
});
