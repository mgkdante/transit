// zod-conformance.test.ts — Gate B: the Zod ⇔ canonical JSON-Schema fact gate.
//
// THE SEAM THIS CLOSES (per the /v1 Contract Doctrine, Notion → Architecture):
//   contract.py (Pydantic) --A--> DB *.schema.json --B--> web schemas/json/* --C--> web Zod
//   A = automated + byte-gated.  B = byte-gated (PR #72).  C = MANUAL, was UNGATED.
// A Python contract change can land and the hand-written Zod silently fall out of
// sync. The audit already caught one such drift (CancellationPeriod.grain was
// required in Zod while the canonical schema makes it optional). This is Gate C/B.
//
// WHAT THIS IS NOT: byte/structural equality (no codegen — the curated
// `.nullable()` honesty and the port-named parse errors must survive). It
// compares FACTS, walking each top-level Zod schema in lockstep with its
// canonical JSON-Schema mirror, following `$ref` into `$defs`. Per field:
//
//   • required — a field NOT `.optional()` in Zod ⟺ the field IS in the JSON
//     Schema's `required[]`. (Zod stricter — required when the canonical says
//     optional — is the drift bug class; we FAIL it.)
//   • nullable — Zod `.nullable()` ⟺ the JSON Schema allows null (a `type`
//     array with "null", or an `anyOf`/`oneOf` branch of `{type:"null"}`).
//     A `default` is NOT nullability — defaulted-non-null fields stay non-nullable.
//   • enum     — a Zod enum/literal-union's members ⟺ the JSON Schema `enum` set
//     (following `$ref` to an enum `$def`), compared as sorted sets.
//
// Every failure names the family, the JSON-pointer-ish field path, and the
// disagreement: "Zod requires X but canonical says Y".

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
	// roots / dictionaries
	ManifestSchema,
	LabelsFileSchema,
	// live tier
	NetworkFileSchema,
	VehiclesFileSchema,
	TripsFileSchema,
	StopDeparturesFileSchema,
	AlertsFileSchema,
	// static tier
	RoutesIndexSchema,
	RouteFileSchema,
	StopsIndexSchema,
	StopFileSchema,
	BasemapFileSchema,
	// historic tier
	RouteReliabilitySchema,
	StopReliabilitySchema,
	ReceiptSchema,
	ReceiptsIndexSchema,
	RouteReliabilityIndexSchema,
	RepeatOffendersSchema,
	HotspotsSchema,
	NetworkTrendSchema,
	AlertHistorySchema,
	AlertArchivePageSchema,
	AlertArchiveIndexSchema,
	HistoricCollectionIndexSchema,
	HistoricAvailabilityIndexSchema,
	// provenance
	ProvenanceSchema,
	// data health (live-lane)
	DataHealthSchema,
} from './index';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ---------------------------------------------------------------------------
// The Zod ⇔ mirror map. Each Zod file's header names its mirror, e.g.
// "Zod mirror of historic_route_reliability.schema.json (title: ...)". This is
// the authoritative pairing; the coverage test below asserts it is exhaustive
// in BOTH directions (no Zod top-level schema unmapped, no JSON mirror orphaned).
// ---------------------------------------------------------------------------

type Family = { label: string; mirror: string; schema: z.ZodTypeAny };

const FAMILIES: Family[] = [
	// roots / dictionaries
	{ label: 'manifest', mirror: 'manifest.schema.json', schema: ManifestSchema },
	{ label: 'labels', mirror: 'static_labels.schema.json', schema: LabelsFileSchema },
	// live tier
	{ label: 'network', mirror: 'live_network.schema.json', schema: NetworkFileSchema },
	{ label: 'vehicles', mirror: 'live_vehicles.schema.json', schema: VehiclesFileSchema },
	{ label: 'trips', mirror: 'live_trips.schema.json', schema: TripsFileSchema },
	{
		label: 'stop_departures',
		mirror: 'live_stop_departures.schema.json',
		schema: StopDeparturesFileSchema,
	},
	{ label: 'alerts', mirror: 'live_alerts.schema.json', schema: AlertsFileSchema },
	// static tier
	{ label: 'routes_index', mirror: 'static_routes_index.schema.json', schema: RoutesIndexSchema },
	{ label: 'route', mirror: 'static_route.schema.json', schema: RouteFileSchema },
	{ label: 'stops_index', mirror: 'static_stops_index.schema.json', schema: StopsIndexSchema },
	{ label: 'stop', mirror: 'static_stop.schema.json', schema: StopFileSchema },
	{ label: 'basemap', mirror: 'static_basemap.schema.json', schema: BasemapFileSchema },
	// historic tier
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
	{ label: 'hotspots', mirror: 'historic_hotspots.schema.json', schema: HotspotsSchema },
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
		label: 'historic_availability_index',
		mirror: 'historic_availability_index.schema.json',
		schema: HistoricAvailabilityIndexSchema,
	},
	// provenance
	{ label: 'provenance', mirror: 'provenance.schema.json', schema: ProvenanceSchema },
	// data health (live-lane per-lane publish freshness + last gate outcome)
	{ label: 'data_health', mirror: 'live_data_health.schema.json', schema: DataHealthSchema },
];

const JSON_DIR = resolve(process.cwd(), 'src/lib/v1/schemas/json');

// ---------------------------------------------------------------------------
// JSON-Schema helpers — read the three facts off a canonical node.
// ---------------------------------------------------------------------------

type JsonNode = Record<string, unknown>;
type JsonSchema = JsonNode & { $defs?: Record<string, JsonNode> };

/** Follow a single `$ref` (only the local "#/$defs/Name" form the exporter emits). */
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

/** Collect the `anyOf`/`oneOf` branches of a node (or [node] if it has none). */
function branches(node: JsonNode): JsonNode[] {
	const alt = (node.anyOf ?? node.oneOf) as JsonNode[] | undefined;
	return Array.isArray(alt) ? alt : [node];
}

/** Does this canonical node permit a JSON null? (type array w/ "null", or an anyOf null branch.) */
function jsonAllowsNull(node: JsonNode): boolean {
	if (Array.isArray(node.type) && (node.type as string[]).includes('null')) return true;
	if (node.nullable === true) return true; // OAS-style, defensive
	return branches(node).some((b) => b.type === 'null');
}

/** The enum members declared on a node (following a `$ref` into a `$def`), else null. */
function jsonEnum(node: JsonNode, root: JsonSchema): string[] | null {
	// A bare enum, or a $ref to an enum $def, or an anyOf with an enum branch.
	const candidates = branches(node).flatMap((b) => {
		const d = deref(b, root);
		return Array.isArray(d.enum) ? [d.enum as string[]] : [];
	});
	const direct = deref(node, root);
	if (Array.isArray(direct.enum)) candidates.unshift(direct.enum as string[]);
	return candidates.length ? candidates[0] : null;
}

/** Resolve the non-null content node of a (possibly nullable / $ref) property to an object/array shape. */
function contentNode(node: JsonNode, root: JsonSchema): JsonNode {
	// Strip a nullable anyOf down to its non-null branch, then deref.
	const nonNull = branches(node).filter((b) => b.type !== 'null');
	const picked = nonNull.length === 1 ? nonNull[0] : node;
	return deref(picked, root);
}

// ---------------------------------------------------------------------------
// Zod helpers — unwrap the curated wrappers, read the three facts.
// ---------------------------------------------------------------------------

type ZodAny = z.ZodTypeAny & {
	_def: { type: string; innerType?: ZodAny; element?: ZodAny; in?: ZodAny; out?: ZodAny };
};

/** Peel optional/nullable/default/readonly/pipe wrappers to the structural core. */
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
			// branded isoUtc() is z.string().min(1).transform(...) → a pipe; the
			// structural input is the `in` side.
			cur = (cur._def.in ?? cur._def.out) as ZodAny;
		} else break;
	}
	return cur;
}

/** The ZodObject's field map, or null if the (unwrapped) schema is not an object. */
function zodShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> | null {
	const core = unwrap(schema);
	if (core._def.type !== 'object') return null;
	const obj = core as unknown as z.ZodObject<z.ZodRawShape>;
	// `.shape` is typed against zod's base $ZodType; the runtime values are full
	// ZodType instances (we call .isOptional()/.isNullable() on them), so widen.
	return (obj.shape as unknown as Record<string, z.ZodTypeAny>) ?? null;
}

/** If the (unwrapped) schema is an array, its element schema; else null. */
function zodArrayElement(schema: z.ZodTypeAny): z.ZodTypeAny | null {
	const core = unwrap(schema);
	if (core._def.type !== 'array') return null;
	return (core._def.element ?? null) as z.ZodTypeAny | null;
}

/** A Zod enum/literal's string members, or null if the (unwrapped) schema is neither. */
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

// ---------------------------------------------------------------------------
// The walker — compare a Zod object's shape against a canonical object node,
// recursing through nested objects and array elements. Pushes one message per
// disagreement onto `out`.
// ---------------------------------------------------------------------------

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

		// --- required fact -----------------------------------------------------
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

		// --- nullable fact -----------------------------------------------------
		const zodNullable = (zodField as { isNullable?: () => boolean }).isNullable?.() ?? false;
		const jsonNullable = jsonAllowsNull(jsonProp);
		if (zodNullable !== jsonNullable) {
			out.push(
				`[${fieldPath}] nullable mismatch — Zod ${zodNullable ? 'allows null (.nullable())' : 'forbids null'} ` +
					`but canonical ${jsonNullable ? 'allows null' : 'forbids null'}.`,
			);
		}

		// --- enum fact ---------------------------------------------------------
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

		// --- recurse: nested object ------------------------------------------
		const content = contentNode(jsonProp, root);
		const nestedShape = zodShape(zodField);
		if (nestedShape && content.type === 'object' && content.properties) {
			const key = `${fieldPath}#obj`;
			if (!visited.has(key)) {
				visited.add(key);
				compareObject(nestedShape, content, root, fieldPath, out, visited);
			}
		}

		// --- recurse: array of objects ---------------------------------------
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

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

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
		// 27 canonical surfaces (live 5 + static 6 + historic 13 + manifest + provenance
		// + data_health).
		expect(onDisk.size).toBe(27);
		expect(FAMILIES.length).toBe(27);
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
