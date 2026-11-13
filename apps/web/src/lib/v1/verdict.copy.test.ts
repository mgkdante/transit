import { expect, it } from 'vitest';
import { verdictCopy } from './verdict.copy';
it.each([
	['en', 'Nov 4', 'Nov 10', 'from Nov 4 to Nov 10 (complete days)'],
	['fr', '4 nov.', '10 nov.', 'du 4 nov. au 10 nov. (jours complets)'],
] as const)('uses already formatted window dates in %s', (locale, from, to, expected) => {
	expect(verdictCopy[locale].closedWindow(from, to)).toBe(expected);
});
