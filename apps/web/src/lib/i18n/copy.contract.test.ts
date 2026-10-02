import { expect, test } from 'vitest';
import type { LocalizedCopy } from './copy';
import { defineCopy } from './index';

type ExpandedLocaleCopy = LocalizedCopy<{ readonly title: string }, 'fr' | 'en' | 'es'>;

// @ts-expect-error Every configured noncanonical locale must remain required.
const incompleteExpandedLocaleCopy: ExpandedLocaleCopy = {
	fr: { title: 'Titre' },
	en: { title: 'Title' },
};
void incompleteExpandedLocaleCopy;

test('the public copy factory preserves the supplied objects and formatters', () => {
	const copy = {
		fr: { title: 'Titre', count: (n: number) => `${n} trajets` },
		en: { title: 'Title', count: (n: number) => `${n} trips` },
	};
	const localized = defineCopy(copy);
	expect(localized).toBe(copy);
	expect(localized.en.count(3)).toBe('3 trips');
});
