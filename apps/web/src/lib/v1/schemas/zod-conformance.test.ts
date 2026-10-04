import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { PublicProviderCatalogSchema } from '../providers';

vi.mock('$env/dynamic/public', () => ({ env: {} }));
import {
	ManifestSchema,
	LabelsFileSchema,
	NetworkFileSchema,
	VehiclesFileSchema,
	TripsFileSchema,
	StopDeparturesFileSchema,
	AlertsFileSchema,
	RoutesIndexSchema,
	RouteFileSchema,
	StopsIndexSchema,
	StopFileSchema,
	BasemapFileSchema,
	RouteReliabilitySchema,
	StopReliabilitySchema,
	ReceiptSchema,
	ReceiptsIndexSchema,
	RouteReliabilityIndexSchema,
	RepeatOffendersSchema,
	HistoricRepeatOffendersDaySchema,
	HotspotsSchema,
	HistoricHotspotsDaySchema,
	NetworkTrendSchema,
	AlertHistorySchema,
	AlertArchivePageSchema,
	AlertArchiveIndexSchema,
	HistoricCollectionIndexSchema,
	HistoricEntityDirectoryIndexSchema,
	NetworkHistoryPartitionSchema,
	LineHistoryPartitionSchema,
	StopHistoryPartitionSchema,
	HistoricAvailabilityIndexSchema,
	ProvenanceSchema,
	DataHealthSchema,
} from './index';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

type Family = { label: string; mirror: string; schema: z.ZodTypeAny };

const FAMILIES: Family[] = [
	{ label: 'providers', mirror: 'providers.schema.json', schema: PublicProviderCatalogSchema },
	{ label: 'manifest', mirror: 'manifest.schema.json', schema: ManifestSchema },
	{ label: 'labels', mirror: 'static_labels.schema.json', schema: LabelsFileSchema },
	{ label: 'network', mirror: 'live_network.schema.json', schema: NetworkFileSchema },
	{ label: 'vehicles', mirror: 'live_vehicles.schema.json', schema: VehiclesFileSchema },
	{ label: 'trips', mirror: 'live_trips.schema.json', schema: TripsFileSchema },
	{
		label: 'stop_departures',
		mirror: 'live_stop_departures.schema.json',
		schema: StopDeparturesFileSchema,
	},
	{ label: 'alerts', mirror: 'live_alerts.schema.json', schema: AlertsFileSchema },
	{ label: 'routes_index', mirror: 'static_routes_index.schema.json', schema: RoutesIndexSchema },
	{ label: 'route', mirror: 'static_route.schema.json', schema: RouteFileSchema },
	{ label: 'stops_index', mirror: 'static_stops_index.schema.json', schema: StopsIndexSchema },
	{ label: 'stop', mirror: 'static_stop.schema.json', schema: StopFileSchema },
	{ label: 'basemap', mirror: 'static_basemap.schema.json', schema: BasemapFileSchema },
	{
		label: 'route_reliability',
		mirror: 'historic_route_reliability.schema.json',
		schema: RouteReliabilitySchema,
	},
	{
		label: 'stop_reliability',
		mirror: 'historic_stop_reliability.schema.json',
		schema: StopReliabilitySchema,
	},
	{ label: 'receipts', mirror: 'historic_receipt.schema.json', schema: ReceiptSchema },
	{
		label: 'receipts_index',
		mirror: 'historic_receipts_index.schema.json',
		schema: ReceiptsIndexSchema,
	},
	{
		label: 'route_reliability_index',
		mirror: 'historic_route_reliability_index.schema.json',
		schema: RouteReliabilityIndexSchema,
	},
	{
		label: 'repeat_offenders',
		mirror: 'historic_repeat_offenders.schema.json',
		schema: RepeatOffendersSchema,
	},
	{
		label: 'historic_repeat_offenders_day',
		mirror: 'historic_repeat_offenders_day.schema.json',
		schema: HistoricRepeatOffendersDaySchema,
	},
	{ label: 'hotspots', mirror: 'historic_hotspots.schema.json', schema: HotspotsSchema },
	{
		label: 'historic_hotspots_day',
		mirror: 'historic_hotspots_day.schema.json',
		schema: HistoricHotspotsDaySchema,
	},
	{
		label: 'network_trend',
		mirror: 'historic_network_trend.schema.json',
		schema: NetworkTrendSchema,
	},
	{
		label: 'alert_history',
		mirror: 'historic_alert_history.schema.json',
		schema: AlertHistorySchema,
	},
	{
		label: 'alert_archive_page',
		mirror: 'historic_alert_archive_page.schema.json',
		schema: AlertArchivePageSchema,
	},
	{
		label: 'alert_archive_index',
		mirror: 'historic_alert_archive_index.schema.json',
		schema: AlertArchiveIndexSchema,
	},
	{
		label: 'historic_collection_index',
		mirror: 'historic_collection_index.schema.json',
		schema: HistoricCollectionIndexSchema,
	},
	{
		label: 'historic_entity_directory_index',
		mirror: 'historic_entity_directory_index.schema.json',
		schema: HistoricEntityDirectoryIndexSchema,
	},
	{
		label: 'historic_network_history_partition',
		mirror: 'historic_network_history_partition.schema.json',
		schema: NetworkHistoryPartitionSchema,
	},
	{
		label: 'historic_line_history_partition',
		mirror: 'historic_line_history_partition.schema.json',
		schema: LineHistoryPartitionSchema,
	},
	{
		label: 'historic_stop_history_partition',
		mirror: 'historic_stop_history_partition.schema.json',
		schema: StopHistoryPartitionSchema,
	},
	{
		label: 'historic_availability_index',
		mirror: 'historic_availability_index.schema.json',
		schema: HistoricAvailabilityIndexSchema,
	},
	{ label: 'provenance', mirror: 'provenance.schema.json', schema: ProvenanceSchema },
	{ label: 'data_health', mirror: 'live_data_health.schema.json', schema: DataHealthSchema },
];

const JSON_DIR = resolve(process.cwd(), 'src/lib/v1/schemas/json');

type JsonNode = Record<string, unknown>;
type JsonSchema = JsonNode & { $defs?: Record<string, JsonNode> };

function deref(node: JsonNode, root: JsonSchema): JsonNode {
	let cur = node;
	const seen = new Set<string>();
	while (typeof cur.$ref === 'string') {
		const ref = cur.$ref;
		if (seen.has(ref)) break;
		seen.add(ref);
		const m = /^#\/\$defs\/(.+)$/.exec(ref);
		if (!m || !root.$defs || !root.$defs[m[1]]) break;
		cur = root.$defs[m[1]];
	}
	return cur;
}

function branches(node: JsonNode): JsonNode[] {
	const alt = (node.anyOf ?? node.oneOf) as JsonNode[] | undefined;
	return Array.isArray(alt) ? alt : [node];
}

function jsonAllowsNull(node: JsonNode): boolean {
	if (Array.isArray(node.type) && (node.type as string[]).includes('null')) return true;
	if (node.nullable === true) return true;
	return branches(node).some((b) => b.type === 'null');
}

function jsonEnum(node: JsonNode, root: JsonSchema): string[] | null {
	const candidates = branches(node).flatMap((b) => {
		const d = deref(b, root);
		if (Array.isArray(d.enum)) return [d.enum as string[]];
		return d.const !== undefined ? [[String(d.const)]] : [];
	});
	const direct = deref(node, root);
	if (Array.isArray(direct.enum)) candidates.unshift(direct.enum as string[]);
	else if (direct.const !== undefined) candidates.unshift([String(direct.const)]);
	return candidates.length ? candidates[0] : null;
}

function contentNode(node: JsonNode, root: JsonSchema): JsonNode {
	const nonNull = branches(node).filter((b) => b.type !== 'null');
	const picked = nonNull.length === 1 ? nonNull[0] : node;
	return deref(picked, root);
}

type ZodAny = z.ZodTypeAny & {
	_def: { type: string; innerType?: ZodAny; element?: ZodAny; in?: ZodAny; out?: ZodAny };
};

function unwrap(schema: z.ZodTypeAny): ZodAny {
	let cur = schema as ZodAny;
	const guard = new Set<ZodAny>();
	while (cur && cur._def && !guard.has(cur)) {
		guard.add(cur);
		const t = cur._def.type;
		if (t === 'optional' || t === 'nullable' || t === 'default' || t === 'readonly') {
			if (!cur._def.innerType) break;
			cur = cur._def.innerType;
		} else if (t === 'pipe') {
			cur = (cur._def.in ?? cur._def.out) as ZodAny;
		} else break;
	}
	return cur;
}

function zodShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> | null {
	const core = unwrap(schema);
	if (core._def.type !== 'object') return null;
	const obj = core as unknown as z.ZodObject<z.ZodRawShape>;
	return (obj.shape as unknown as Record<string, z.ZodTypeAny>) ?? null;
}

function zodArrayElement(schema: z.ZodTypeAny): z.ZodTypeAny | null {
	const core = unwrap(schema);
	if (core._def.type !== 'array') return null;
	return (core._def.element ?? null) as z.ZodTypeAny | null;
}

function zodEnum(schema: z.ZodTypeAny): string[] | null {
	const core = unwrap(schema);
	if (core._def.type === 'enum') {
		const e = core as unknown as z.ZodEnum<Record<string, string>>;
		return [...e.options];
	}
	if (core._def.type === 'literal') {
		const lit = core as unknown as { _def: { values?: unknown[] } };
		const vals = lit._def.values;
		if (Array.isArray(vals)) return vals.map(String);
	}
	return null;
}

const sortedEq = (a: string[], b: string[]) =>
	a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');

function compareObject(
	zodObj: Record<string, z.ZodTypeAny>,
	jsonNode: JsonNode,
	root: JsonSchema,
	path: string,
	out: string[],
	visited: Set<string>,
): void {
	const props = (jsonNode.properties ?? {}) as Record<string, JsonNode>;
	const requiredSet = new Set((jsonNode.required as string[] | undefined) ?? []);

	for (const [field, zodField] of Object.entries(zodObj)) {
		const fieldPath = `${path}.${field}`;
		const jsonProp = props[field];

		if (!jsonProp) {
			out.push(
				`[${path}] field "${field}" — Zod declares it but the canonical schema has no such property ` +
					`(extra field; mirror does not define it).`,
			);
			continue;
		}

		const zodOptional = (zodField as { isOptional?: () => boolean }).isOptional?.() ?? false;
		const zodRequired = !zodOptional;
		const jsonRequired = requiredSet.has(field);
		if (zodRequired !== jsonRequired) {
			out.push(
				`[${fieldPath}] required mismatch — Zod ${zodRequired ? 'requires' : 'makes optional'} ` +
					`but canonical says ${jsonRequired ? 'required' : 'optional'}` +
					(zodRequired && !jsonRequired
						? ' (Zod is STRICTER than the contract — the drift bug class; add .optional()).'
						: '.'),
			);
		}

		const zodNullable = (zodField as { isNullable?: () => boolean }).isNullable?.() ?? false;
		const jsonNullable = jsonAllowsNull(jsonProp);
		if (zodNullable !== jsonNullable) {
			out.push(
				`[${fieldPath}] nullable mismatch — Zod ${zodNullable ? 'allows null (.nullable())' : 'forbids null'} ` +
					`but canonical ${jsonNullable ? 'allows null' : 'forbids null'}.`,
			);
		}

		const zEnum = zodEnum(zodField);
		const jEnum = jsonEnum(jsonProp, root);
		if (zEnum && jEnum) {
			if (!sortedEq(zEnum, jEnum)) {
				out.push(
					`[${fieldPath}] enum mismatch — Zod has {${[...zEnum].sort().join(', ')}} ` +
						`but canonical has {${[...jEnum].sort().join(', ')}}.`,
				);
			}
		} else if (zEnum && !jEnum) {
			out.push(
				`[${fieldPath}] enum mismatch — Zod constrains to {${[...zEnum].sort().join(', ')}} ` +
					`but canonical declares no enum (free value).`,
			);
		} else if (!zEnum && jEnum) {
			out.push(
				`[${fieldPath}] enum mismatch — canonical constrains to {${[...jEnum].sort().join(', ')}} ` +
					`but Zod does not (free value — should be a z.enum).`,
			);
		}

		const content = contentNode(jsonProp, root);
		const nestedShape = zodShape(zodField);
		if (nestedShape && content.type === 'object' && content.properties) {
			const key = `${fieldPath}#obj`;
			if (!visited.has(key)) {
				visited.add(key);
				compareObject(nestedShape, content, root, fieldPath, out, visited);
			}
		}

		const element = zodArrayElement(zodField);
		if (element && content.type === 'array' && content.items) {
			const itemContent = contentNode(content.items as JsonNode, root);
			const elementShape = zodShape(element);
			if (elementShape && itemContent.type === 'object' && itemContent.properties) {
				const key = `${fieldPath}[]#obj`;
				if (!visited.has(key)) {
					visited.add(key);
					compareObject(elementShape, itemContent, root, `${fieldPath}[]`, out, visited);
				}
			}
		}
	}
}

describe('Gate B — Zod ⇔ canonical JSON-Schema conformance', () => {
	it('the Zod↔mirror map is exhaustive in both directions (no orphan either side)', () => {
		const mapped = new Set(FAMILIES.map((f) => f.mirror));
		const onDisk = new Set(readdirSync(JSON_DIR).filter((f) => f.endsWith('.schema.json')));

		const unmappedOnDisk = [...onDisk].filter((f) => !mapped.has(f)).sort();
		const missingFiles = [...mapped].filter((f) => !onDisk.has(f)).sort();

		expect(
			unmappedOnDisk,
			`Canonical mirror(s) with no Zod schema in FAMILIES — every JSON mirror must be paired ` +
				`(do not silently skip): ${unmappedOnDisk.join(', ')}`,
		).toEqual([]);
		expect(
			missingFiles,
			`FAMILIES references a mirror file that is not on disk: ${missingFiles.join(', ')}`,
		).toEqual([]);
		expect(onDisk.size).toBe(34);
		expect(FAMILIES.length).toBe(34);
	});

	for (const family of FAMILIES) {
		it(`[${family.label}] Zod facts match ${family.mirror}`, () => {
			const root = JSON.parse(readFileSync(join(JSON_DIR, family.mirror), 'utf-8')) as JsonSchema;
			const topShape = zodShape(family.schema);
			expect(topShape, `${family.label}: top-level Zod schema is not a ZodObject`).not.toBeNull();

			const violations: string[] = [];
			compareObject(topShape!, root, root, family.label, violations, new Set());

			expect(
				violations,
				`Zod ⇔ canonical drift in ${family.mirror}. The web Zod must never be STRICTER ` +
					`than the canonical /v1 contract (fix the Zod side, never loosen the mirror):\n` +
					violations.join('\n'),
			).toEqual([]);
		});
	}
});
