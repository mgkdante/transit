import { describe, expect, it } from 'vitest';
import { foldDiacritics, foldSearchText, tokenize, tokenMatchScore } from './normalize';

describe('foldDiacritics', () => {
	it('strips accents and lowercases without touching separators', () => {
		expect(foldDiacritics('Crémazie')).toBe('cremazie');
		expect(foldDiacritics('Côte-Vertu')).toBe('cote-vertu');
		expect(foldDiacritics('Honoré-Beaugrand')).toBe('honore-beaugrand');
	});

	it('is null-safe and idempotent', () => {
		expect(foldDiacritics(null)).toBe('');
		expect(foldDiacritics(undefined)).toBe('');
		expect(foldDiacritics(foldDiacritics('Vendôme'))).toBe('vendome');
	});
});

describe('foldSearchText', () => {
	it('folds accents, separators, and collapses whitespace', () => {
		expect(foldSearchText('Station Berri-UQAM')).toBe('station berri uqam');
		expect(foldSearchText('Crémazie')).toBe('cremazie');
		expect(foldSearchText("Place-d'Armes")).toBe('place d armes');
		expect(foldSearchText('Berri / Fleury')).toBe('berri fleury');
		expect(foldSearchText('  double   spaces  ')).toBe('double spaces');
	});

	it('returns empty for nullish/blank input', () => {
		expect(foldSearchText(null)).toBe('');
		expect(foldSearchText('   ')).toBe('');
	});
});

describe('tokenize', () => {
	it('splits the folded query into tokens', () => {
		expect(tokenize('Berri-UQAM')).toEqual(['berri', 'uqam']);
		expect(tokenize('')).toEqual([]);
	});
});

describe('tokenMatchScore', () => {
	it('tiers exact < prefix < substring < token-AND', () => {
		expect(tokenMatchScore(['berri uqam'], 'berri uqam')).toBe(0);
		expect(tokenMatchScore(['station berri uqam'], 'station berri')).toBe(1);
		expect(tokenMatchScore(['station berri uqam'], 'berri uqam')).toBe(2);
		// out-of-order tokens, non-contiguous → token-AND tier
		expect(tokenMatchScore(['station berri uqam'], 'uqam berri')).toBe(3);
	});

	it('finds métro stations the way people type them', () => {
		expect(tokenMatchScore(['Station Berri-UQAM'], 'berri uqam')).not.toBeNull();
		expect(tokenMatchScore(['Station Berri-UQAM'], 'berri-uqam')).not.toBeNull();
		expect(tokenMatchScore(['Station Crémazie'], 'cremazie')).not.toBeNull();
	});

	it('matches an intersection in either street order', () => {
		expect(tokenMatchScore(['Berri / Fleury'], 'berri fleury')).toBe(0);
		expect(tokenMatchScore(['Fleury / Berri'], 'berri fleury')).toBe(3);
	});

	it('returns null when a token is unmatched or the query is empty', () => {
		expect(tokenMatchScore(['Station Berri-UQAM'], 'berri laval')).toBeNull();
		expect(tokenMatchScore(['anything'], '   ')).toBeNull();
		expect(tokenMatchScore([null, undefined, ''], 'berri')).toBeNull();
	});
});
