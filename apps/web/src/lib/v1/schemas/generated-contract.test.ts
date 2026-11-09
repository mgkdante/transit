import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as generated from './generated';

const jsonDir = new URL('./json/', import.meta.url);
const outputDir = new URL('./generated/', import.meta.url);
const generatorUrl = new URL('../../../../scripts/gen-contract.mjs', import.meta.url);
const { generateModule } = await import(/* @vite-ignore */ generatorUrl.href);

describe('generated snapshot contract', () => {
	it('pairs every mirror with exactly one generated family export and current module', () => {
		const files = readdirSync(jsonDir)
			.filter((file) => file.endsWith('.schema.json'))
			.sort();
		const names = files.map((file) => {
			const root = JSON.parse(readFileSync(new URL(file, jsonDir), 'utf8'));
			const module = new URL(file.replace('.schema.json', '.ts'), outputDir);
			expect(readFileSync(module, 'utf8'), file).toBe(generateModule(root));
			return `${root.title}Schema`;
		});
		expect(new Set(names).size).toBe(34);
		expect(Object.keys(generated).sort()).toEqual(names.sort());
		expect(
			readdirSync(outputDir)
				.filter((file) => file !== 'index.ts')
				.sort(),
		).toEqual(files.map((file) => file.replace('.schema.json', '.ts')));
		for (const schema of Object.values(generated)) expect(schema.safeParse).toBeTypeOf('function');
	});

	it.each([
		{ title: 'Future', type: 'object', futureKeyword: true },
		{
			title: 'Future',
			type: 'object',
			properties: { value: { anyOf: [{ type: 'string' }, { type: 'null', futureKeyword: true }] } },
		},
		{ title: 'Future', type: 'object', $defs: { Unused: { type: 'string', futureKeyword: true } } },
	])('rejects unknown keywords, including nested and unused definitions', (root) => {
		expect(() => generateModule(root)).toThrow('Unsupported keyword: futureKeyword');
	});
});

it('accepts legacy vehicles and preserves the OC Transpo e2e next stop coordinates', () => {
	const fixture = JSON.parse(
		readFileSync(new URL('../../../../e2e/octranspo-vehicles.json', import.meta.url), 'utf8'),
	);
	const parsed = generated.VehiclesFileSchema.parse(fixture);
	expect(parsed.vehicles[0].next_stop_lat).toBe(45.42153);
	expect(parsed.vehicles[0].next_stop_lon).toBe(-75.69719);
	const { next_stop_lat, next_stop_lon, ...legacy } = fixture.vehicles[0];
	expect(next_stop_lat).toBeTypeOf('number');
	expect(next_stop_lon).toBeTypeOf('number');
	expect(generated.VehiclesFileSchema.safeParse({ ...fixture, vehicles: [legacy] }).success).toBe(
		true,
	);
});
