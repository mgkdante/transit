import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { PublicProviderCatalogSchema } from '../providers';
import * as s from './index';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

type Node = {
	$ref?: string;
	$defs?: Record<string, Node>;
	properties?: Record<string, Node>;
	required?: string[];
	anyOf?: Node[];
	type?: string;
	enum?: unknown[];
	const?: unknown;
	items?: Node;
	additionalProperties?: boolean | Node;
};
const families = [
	['providers', PublicProviderCatalogSchema],
	['historic_availability_index', s.HistoricAvailabilityIndexSchema],
	['historic_collection_index', s.HistoricCollectionIndexSchema],
	['historic_entity_directory_index', s.HistoricEntityDirectoryIndexSchema],
	['historic_network_history_partition', s.NetworkHistoryPartitionSchema],
	['historic_line_history_partition', s.LineHistoryPartitionSchema],
	['historic_stop_history_partition', s.StopHistoryPartitionSchema],
	['historic_hotspots', s.HotspotsSchema],
	['historic_hotspots_day', s.HistoricHotspotsDaySchema],
	['historic_repeat_offenders', s.RepeatOffendersSchema],
	['historic_repeat_offenders_day', s.HistoricRepeatOffendersDaySchema],
] as const;
const mirror = (family: string): Node =>
	JSON.parse(readFileSync(new URL(`./json/${family}.schema.json`, import.meta.url), 'utf8'));

type ZNode = z.ZodType & {
	shape?: Record<string, z.ZodType>;
	options?: unknown[];
	_def: {
		innerType?: z.ZodType;
		in?: z.ZodType;
		element?: z.ZodType;
		items?: z.ZodType[];
		valueType?: z.ZodType;
		values?: unknown[];
	};
};
function unwrap(schema: z.ZodType): ZNode {
	const core = schema as ZNode;
	const inner = core._def.innerType ?? core._def.in;
	return inner ? unwrap(inner) : core;
}

function differences(schema: z.ZodType, root: Node): string[] {
	const out: string[] = [];
	const deref = (node: Node): Node =>
		node.$ref ? deref(root.$defs![node.$ref.split('/').at(-1)!]) : node;
	function visit(schema: z.ZodType, node: Node, path: string): void {
		node = deref(node);
		const nullable = node.type === 'null' || !!node.anyOf?.some((b) => deref(b).type === 'null');
		if (schema.isNullable() !== nullable) out.push(`${path}: nullable`);
		const body = deref(node.anyOf?.find((b) => deref(b).type !== 'null') ?? node);
		const core = unwrap(schema);
		const zEnum = core.options ?? core._def.values;
		const jEnum = body.enum ?? ('const' in body ? [body.const] : undefined);
		if (JSON.stringify(zEnum?.slice().sort()) !== JSON.stringify(jEnum?.slice().sort())) {
			out.push(`${path}: enum`);
		}
		if (body.properties) {
			const shape = core.shape ?? {};
			for (const field of new Set([...Object.keys(shape), ...Object.keys(body.properties)])) {
				const childPath = path ? `${path}.${field}` : field;
				const child = shape[field];
				const property = body.properties[field];
				if (!child || !property) out.push(`${childPath}: field`);
				else {
					if (!child.isOptional() !== !!body.required?.includes(field)) {
						out.push(`${childPath}: required`);
					}
					visit(child, property, childPath);
				}
			}
		} else if (typeof body.additionalProperties === 'object') {
			if (core._def.valueType) visit(core._def.valueType, body.additionalProperties, `${path}{}`);
			for (const [field, child] of Object.entries(core.shape ?? {})) {
				visit(child, body.additionalProperties, `${path}.${field}`);
			}
		}
		if (body.items) {
			for (const item of core._def.items ?? (core._def.element ? [core._def.element] : [])) {
				visit(item, body.items, `${path}[]`);
			}
		}
	}
	visit(schema, root, '');
	return out;
}

describe('hand-written production schema conformance', () => {
	for (const [family, schema] of families) {
		it(`${family} preserves mirrored fields, requiredness, nullability and enum sets`, () => {
			expect(differences(schema, mirror(family))).toEqual([]);
		});
	}

	it('detects a mirror making PublicProvider.inputs optional', () => {
		const root = mirror('providers');
		const provider = root.$defs!.PublicProvider;
		provider.required = provider.required!.filter((field) => field !== 'inputs');
		expect(differences(PublicProviderCatalogSchema, root)).toContain(
			'providers[].inputs: required',
		);
	});

	it('detects an extension hiding a mirror-required NetworkHistoryDay.delay', () => {
		const root = mirror('historic_network_history_partition');
		const day = root.$defs!.NetworkHistoryDay;
		day.required = [...day.required!, 'delay'];
		expect(differences(s.NetworkHistoryPartitionSchema, root)).toContain('days[].delay: required');
	});
});
