import { describe, expect, it } from 'vitest';
import { reliabilityCopy } from './reliability.copy';
import { routeVerdictCopy } from './routeVerdict.copy';

describe('routeVerdictCopy', () => {
	it.each(['en', 'fr'] as const)('stays shared with the full %s reliability copy', (locale) => {
		const full = reliabilityCopy[locale];
		const lightweight = routeVerdictCopy[locale];

		expect(full.verdict).toBe(lightweight.verdict);
		expect(full.history.headerCurrentOnly).toBe(lightweight.history.headerCurrentOnly);
	});
});
