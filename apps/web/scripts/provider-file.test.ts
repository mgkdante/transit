import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readProviderFile } from './provider-file';

const labels = {
	en: { city: 'Exampleville', operator: 'EVT' },
	fr: { city: 'Exampleville', operator: 'EVT' },
};
const legacy = {
	provider: { provider_id: 'fixture_city', is_active: false },
	public: { enabled: false, labels },
};
const declaration = { declaration: 2, id: 'fixture_city', stage: 'candidate', labels };
const expected = { id: 'fixture_city', active: false, publicEnabled: false, labels };
function read(payload: unknown, name = 'fixture_city.yaml') {
	const dir = mkdtempSync(join(tmpdir(), 'provider-file-'));
	try {
		const path = join(dir, name);
		writeFileSync(path, typeof payload === 'string' ? payload : JSON.stringify(payload));
		return readProviderFile(path);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
test("reads a provider file in today's shape", () => {
	expect(read(legacy)).toEqual(expected);
});
test('reads a declaration', () => {
	expect(read(declaration)).toEqual(expected);
});
test('gives equal values for both shapes of one provider', () => {
	expect(read(declaration)).toEqual(read(legacy));
});
for (const [stage, active, publicEnabled] of [
	['candidate', false, false],
	['capturing', true, false],
	['public', true, true],
] as const) {
	test(`projects ${stage}`, () => {
		expect(read({ ...declaration, stage })).toEqual({ ...expected, active, publicEnabled });
	});
}
test('permits old inactive or nonpublic files without labels', () => {
	for (const is_active of [false, true]) {
		expect(read({ provider: { ...legacy.provider, is_active } })).toEqual({
			id: 'fixture_city',
			active: is_active,
			publicEnabled: false,
			labels: undefined,
		});
	}
	expect(read({ ...legacy, public: { enabled: true } }).labels).toBeUndefined();
});
for (const payload of [
	{ ...declaration, declaration: 3 },
	{ ...declaration, declaration: undefined },
	{ ...declaration, stage: 'unknown' },
	{ ...declaration, id: 'other' },
	{ ...declaration, provider: legacy.provider },
	{ ...legacy, id: 'fixture_city' },
	{ ...declaration, stage: 'public', labels: undefined },
	{ ...legacy, provider: { ...legacy.provider, is_active: true }, public: { enabled: true } },
	'id: [private-payload',
]) {
	test('refuses invalid or hybrid input safely', () => {
		expect(() => read(payload)).toThrow('fixture_city.yaml: invalid provider file');
	});
}
test('returns only the build projection', () => {
	expect(read({ ...declaration, feeds: [{ auth: 'private-payload' }] })).toEqual(expected);
});
