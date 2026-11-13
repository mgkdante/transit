import { expect, it } from 'vitest';
import { createLineDirectory } from './lineDirectory';

it('labels a line by its number, then its name', () => {
	const routes = [
		{ id: '49', short: '49', long: 'Maurice-Duplessis', type: 3 },
		{ id: '1-373', short: '1', long: 'Confederation', type: 1 },
		{ id: 'opaque', short: '7', type: 3 },
	];
	for (const word of ['Line', 'Ligne']) {
		const copy = { line: (id: string) => `${word} ${id}` };
		const directory = createLineDirectory(routes, copy);
		expect(directory.name('49')).toEqual({
			number: '49',
			name: 'Maurice-Duplessis',
			label: '49 · Maurice-Duplessis',
			spoken: `${word} 49 · Maurice-Duplessis`,
		});
		expect(directory.name('1-373').number).toBe('1');
		expect(directory.number('1-373')).toBe('1');
		expect(directory.name('opaque').label).toBe('7');
		expect(directory.name('opaque', '7').label).toBe('7');
		expect(directory.name('49', 'Published').label).toBe('49 · Published');
		expect(directory.name('104E', 'Lansdowne')).toEqual({
			number: null,
			name: 'Lansdowne',
			label: 'Lansdowne',
			spoken: `${word} Lansdowne`,
		});
		expect(directory.name('104E').label).toBe(`${word} 104E`);
		expect(directory.name('104E').spoken).toBe(`${word} 104E`);
		expect(directory.number('104E')).toBe('104E');
		expect(directory.spoken('Confederation')).toBe(`${word} Confederation`);
		expect(createLineDirectory(null, copy).name('49').number).toBeNull();
		expect(createLineDirectory(null, copy).name('49', 'Published').label).toBe('Published');
	}
});
