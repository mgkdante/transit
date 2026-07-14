import { describe, expect, it } from 'vitest';
import { decodeHistoryEntityId, encodeHistoryEntityId } from './entity';

const VECTORS = [
	['A', '41'],
	['747', '373437'],
	['A/B', '412f42'],
	['%2F', '253246'],
	['?x#y', '3f782379'],
	['..', '2e2e'],
	['with spaces', '7769746820737061636573'],
	['Édouard', 'c389646f75617264'],
	['東京', 'e69db1e4baac'],
	['خط', 'd8aed8b7'],
	['🚇', 'f09f9a87'],
] as const;

describe('retained-history entity identity', () => {
	for (const [entityId, expectedHex] of VECTORS) {
		it(`round-trips ${JSON.stringify(entityId)} as lowercase UTF-8 hex`, () => {
			const encoded = encodeHistoryEntityId(entityId);
			expect(encoded).toBe(expectedHex);
			expect(decodeHistoryEntityId(encoded)).toBe(entityId);
		});
	}

	it.each(['', 'C3A9', 'abc', 'gg', 'c3zz', 'ff', 'c328'])(
		'rejects noncanonical or invalid UTF-8 encoded ID %j',
		(encodedId) => {
			expect(() => decodeHistoryEntityId(encodedId)).toThrow();
		},
	);

	it('rejects an empty raw entity ID', () => {
		expect(() => encodeHistoryEntityId('')).toThrow();
	});

	it.each(['\ud800', '\udc00'])('rejects lone UTF-16 surrogate raw ID %j', (entityId) => {
		expect(() => encodeHistoryEntityId(entityId)).toThrow();
	});
});
