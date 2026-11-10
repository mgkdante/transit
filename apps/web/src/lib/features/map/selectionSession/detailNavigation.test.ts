import { describe, expect, it } from 'vitest';
import { emptyHistory, visit, travel, neighbors } from './detailNavigation';

describe('detail navigation', () => {
	it('keeps picks and related jumps, deduplicates, and discards forward history on a new visit', () => {
		const stop = { kind: 'stop', id: 'S1' } as const;
		const line = { kind: 'route', id: '24', direction: 0, variantKey: 'east' } as const;
		let history = visit(visit(emptyHistory(), stop), line);
		expect(visit(history, { ...line })).toBe(history);
		history = travel(history, -1);
		expect(history.entries[history.cursor]).toEqual(stop);
		expect(travel(history, -1)).toBe(history);
		expect(travel(history, 1).entries[1]).toEqual(line);
		history = visit(history, { ...line, variantKey: 'west' });
		expect(history.entries).toEqual([stop, { ...line, variantKey: 'west' }]);
		expect(travel(history, 1)).toBe(history);
	});
	it('does not wrap endpoints or navigate a missing item', () => {
		const items = ['a', 'b', 'c'].map((id) => ({ kind: 'stop' as const, id }));
		expect(neighbors(items[0], items)).toEqual({
			previous: null,
			next: items[1],
			position: 1,
			total: 3,
		});
		expect(neighbors(items[1], items)).toEqual({
			previous: items[0],
			next: items[2],
			position: 2,
			total: 3,
		});
		expect(neighbors(items[2], items)).toEqual({
			previous: items[1],
			next: null,
			position: 3,
			total: 3,
		});
		expect(neighbors({ kind: 'stop', id: 'gone' }, items)).toEqual({
			previous: null,
			next: null,
			position: null,
			total: 3,
		});
	});
});
