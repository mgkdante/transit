import { adapter, type AdapterCtx } from '$lib/v1/adapter';
import {
	HistoryArtifactContractError,
	HistoryTransientPublicationError,
	canonicalHistoryJson,
} from '$lib/v1/history/partitions';
import {
	isHistoryFamilyIndexPath,
	isHistoryPointArtifactPath,
	type RetainedPointHistoryFamily,
} from '$lib/v1/history/pointers';
import { addIsoDays, strictIsoDate } from '$lib/v1/history/selection';
import { sha256Hex, type RawJsonEntity } from '$lib/v1/http';
import type {
	HistoricAvailabilityIndex,
	HistoricCollectionIndex,
	HistoricFamilyAvailability,
	HistoricHotspotsDay,
	HistoricPartitionRef,
	HistoricRepeatOffendersDay,
} from '$lib/v1/schemas';
import {
	SHA256_PATTERN,
	abortError,
	freshHistoryCtx,
	historyRootPath,
	verifyPartitionBytes,
} from './historyIntegrity';

interface PointHistoryDayByFamily {
	readonly hotspots: HistoricHotspotsDay;
	readonly repeat_offenders: HistoricRepeatOffendersDay;
}

function pointRootEdge(
	root: HistoricAvailabilityIndex,
	family: RetainedPointHistoryFamily,
): HistoricFamilyAvailability | null {
	const matches = (root.families ?? []).filter((entry) => entry.family === family);
	if (matches.length > 1) {
		throw new HistoryArtifactContractError(historyRootPath(), `duplicate ${family} root edge`);
	}
	const edge = matches[0];
	if (edge === undefined) return null;
	if (
		edge.selection_mode !== 'date' ||
		!isHistoryFamilyIndexPath(family, edge.index_path) ||
		!SHA256_PATTERN.test(edge.collection_generation_id ?? '') ||
		(edge.metrics ?? []).length !== 0
	) {
		throw new HistoryArtifactContractError(edge.index_path, `invalid ${family} root edge`);
	}
	const first = edge.first_available_date;
	const last = edge.last_available_date;
	if (
		(first == null) !== (last == null) ||
		(first != null && (!strictIsoDate(first) || !strictIsoDate(last) || first > last!))
	) {
		throw new HistoryArtifactContractError(edge.index_path, `invalid ${family} root coverage`);
	}
	return edge;
}

function pointIndexError(path: string, message: string): never {
	throw new HistoryArtifactContractError(path, message);
}

function pointHistoryGaps(dates: readonly string[]): Array<{
	readonly start_date: string;
	readonly end_date: string;
	readonly reason: null;
}> {
	const gaps: Array<{ start_date: string; end_date: string; reason: null }> = [];
	for (let position = 1; position < dates.length; position += 1) {
		const start = addIsoDays(dates[position - 1], 1);
		const end = addIsoDays(dates[position], -1);
		if (start <= end) gaps.push({ start_date: start, end_date: end, reason: null });
	}
	return gaps;
}

function exactPointGaps(
	actual: HistoricCollectionIndex['gaps'],
	expected: ReturnType<typeof pointHistoryGaps>,
): boolean {
	const gaps = actual ?? [];
	return (
		gaps.length === expected.length &&
		gaps.every(
			(gap, position) =>
				gap.start_date === expected[position]?.start_date &&
				gap.end_date === expected[position]?.end_date &&
				gap.reason == null,
		)
	);
}

function pointGenerationBasis(
	index: HistoricCollectionIndex,
	family: RetainedPointHistoryFamily,
	dates: readonly string[],
	refs: readonly HistoricPartitionRef[],
) {
	return {
		family,
		selection_mode: 'date',
		entity_id: null,
		first_available_date: dates[0] ?? null,
		last_available_date: dates.at(-1) ?? null,
		available_dates: [...dates],
		gaps: (index.gaps ?? []).map((gap) => ({
			start_date: gap.start_date,
			end_date: gap.end_date,
			reason: gap.reason ?? null,
		})),
		partitions: refs.map((ref) => ({
			path: ref.path,
			coverage_start: ref.coverage_start,
			coverage_end: ref.coverage_end,
			count: ref.count,
			sha256: ref.sha256,
			byte_size: ref.byte_size,
		})),
		metrics: [],
	};
}

async function assertPointHistoryIndex(
	family: RetainedPointHistoryFamily,
	index: HistoricCollectionIndex,
	path: string,
): Promise<HistoricCollectionIndex> {
	if (
		index.family !== family ||
		index.selection_mode !== 'date' ||
		index.entity_id != null ||
		!SHA256_PATTERN.test(index.collection_generation_id ?? '') ||
		index.methodology_version !== 'history-1' ||
		typeof index.publish_generation_id !== 'string' ||
		index.publish_generation_id.length === 0 ||
		(index.metrics ?? []).length !== 0
	) {
		pointIndexError(path, `invalid ${family} point history index identity`);
	}

	const dates = index.available_dates ?? [];
	if (
		dates.some((date) => !strictIsoDate(date)) ||
		dates.some((date, position) => position > 0 && date <= dates[position - 1])
	) {
		pointIndexError(path, `${family} available dates must be real, sorted, and unique`);
	}
	const first = dates[0] ?? null;
	const last = dates.at(-1) ?? null;
	const expectedGaps = pointHistoryGaps(dates);
	if (
		index.first_available_date !== first ||
		index.last_available_date !== last ||
		!exactPointGaps(index.gaps, expectedGaps)
	) {
		pointIndexError(path, `${family} point history coverage does not match available dates`);
	}

	const refs = index.partitions ?? [];
	if (refs.length !== dates.length) {
		pointIndexError(path, `${family} point history requires one ref per available date`);
	}
	const paths = new Set<string>();
	for (const [position, date] of dates.entries()) {
		const ref = refs[position];
		if (ref === undefined) {
			pointIndexError(path, `${family} point history ref is missing`);
		}
		if (
			ref.coverage_start !== date ||
			ref.coverage_end !== date ||
			ref.count !== 1 ||
			!SHA256_PATTERN.test(ref.sha256 ?? '') ||
			!Number.isSafeInteger(ref.byte_size) ||
			(ref.byte_size ?? 0) <= 0 ||
			!isHistoryPointArtifactPath(family, date, ref.path) ||
			!ref.path.includes(`/generations/${ref.sha256}/`)
		) {
			pointIndexError(ref.path, `invalid ${family} point history ref for ${date}`);
		}
		if (paths.has(ref.path)) {
			pointIndexError(ref.path, `duplicate ${family} point history ref`);
		}
		paths.add(ref.path);
	}

	const expectedGeneration = await sha256Hex(
		new TextEncoder().encode(
			canonicalHistoryJson(pointGenerationBasis(index, family, dates, refs)),
		),
	);
	if (index.collection_generation_id !== expectedGeneration) {
		pointIndexError(path, `${family} collection generation does not match exact index semantics`);
	}
	return index;
}

function pointRootMatchesIndex(
	edge: HistoricFamilyAvailability,
	index: HistoricCollectionIndex,
): boolean {
	return (
		edge.collection_generation_id === index.collection_generation_id &&
		edge.first_available_date === index.first_available_date &&
		edge.last_available_date === index.last_available_date &&
		exactPointGaps(edge.gaps, pointHistoryGaps(index.available_dates ?? [])) &&
		(edge.metrics ?? []).length === 0
	);
}

function readPointHistoryIndex(
	family: RetainedPointHistoryFamily,
	path: string,
	ctx?: AdapterCtx,
): Promise<HistoricCollectionIndex | null> {
	return family === 'hotspots'
		? adapter.historic.hotspotsHistoryIndex(path, ctx)
		: adapter.historic.repeatOffendersHistoryIndex(path, ctx);
}

async function getPointHistoryIndex(
	family: RetainedPointHistoryFamily,
	ctx?: AdapterCtx,
): Promise<HistoricCollectionIndex | null> {
	const root = await adapter.historic.historyIndex(ctx);
	if (root === null) return null;
	const edge = pointRootEdge(root, family);
	if (edge === null) return null;
	const index = await readPointHistoryIndex(family, edge.index_path, ctx);
	if (index === null) {
		throw new HistoryArtifactContractError(edge.index_path, 'advertised history index not found');
	}
	await assertPointHistoryIndex(family, index, edge.index_path);
	if (pointRootMatchesIndex(edge, index)) return index;

	const refreshCtx = freshHistoryCtx(ctx);
	let freshRoot: HistoricAvailabilityIndex;
	try {
		const refreshed = await adapter.historic.historyIndex(refreshCtx);
		if (refreshed === null) {
			throw new HistoryTransientPublicationError(
				edge.index_path,
				`${family} root disappeared during bounded pointer-chain refresh`,
			);
		}
		freshRoot = refreshed;
	} catch (error) {
		if (abortError(error)) throw error;
		if (error instanceof HistoryTransientPublicationError) throw error;
		throw new HistoryTransientPublicationError(
			edge.index_path,
			`${family} root could not be refreshed during bounded pointer-chain recovery`,
		);
	}
	const freshEdge = pointRootEdge(freshRoot, family);
	if (freshEdge === null) {
		throw new HistoryTransientPublicationError(
			edge.index_path,
			`${family} root edge disappeared during bounded pointer-chain refresh`,
		);
	}
	if (freshEdge.index_path === edge.index_path && pointRootMatchesIndex(freshEdge, index)) {
		return index;
	}

	const freshIndex = await readPointHistoryIndex(family, freshEdge.index_path, refreshCtx);
	if (freshIndex === null) {
		throw new HistoryArtifactContractError(
			freshEdge.index_path,
			'advertised history index not found',
		);
	}
	await assertPointHistoryIndex(family, freshIndex, freshEdge.index_path);
	if (pointRootMatchesIndex(freshEdge, freshIndex)) return freshIndex;
	throw new HistoryTransientPublicationError(
		freshEdge.index_path,
		`${family} generation still disagrees after one bounded pointer-chain refresh`,
	);
}

function readPointHistoryDay<F extends RetainedPointHistoryFamily>(
	family: F,
	date: string,
	path: string,
	ctx?: AdapterCtx,
): Promise<RawJsonEntity<PointHistoryDayByFamily[F]> | null> {
	return (
		family === 'hotspots'
			? adapter.historic.hotspotsHistoryDay(date, path, ctx)
			: adapter.historic.repeatOffendersHistoryDay(date, path, ctx)
	) as Promise<RawJsonEntity<PointHistoryDayByFamily[F]> | null>;
}

async function getPointHistoryDay<F extends RetainedPointHistoryFamily>(
	family: F,
	date: string,
	index: HistoricCollectionIndex,
	ctx?: AdapterCtx,
): Promise<PointHistoryDayByFamily[F]> {
	await assertPointHistoryIndex(family, index, historyRootPath());
	const dates = index.available_dates ?? [];
	if (!strictIsoDate(date)) {
		throw new RangeError(`invalid ${family} history date: ${date}`);
	}
	if (!dates.includes(date)) {
		throw new RangeError(`${family} history date is not advertised: ${date}`);
	}
	if (date === dates.at(-1)) {
		throw new RangeError(`${family} latest history date uses the current snapshot: ${date}`);
	}
	const position = dates.indexOf(date);
	const ref = index.partitions?.[position];
	if (ref === undefined) {
		throw new HistoryArtifactContractError(historyRootPath(), 'advertised history ref not found');
	}
	const raw = await readPointHistoryDay(family, date, ref.path, ctx);
	if (raw === null) {
		throw new HistoryArtifactContractError(ref.path, 'advertised history artifact not found');
	}
	await verifyPartitionBytes(ref, raw);
	if (
		raw.value.date !== date ||
		raw.value.methodology_version !== 'reliability-1' ||
		raw.value.publish_generation_id != null
	) {
		throw new HistoryArtifactContractError(ref.path, 'advertised point history payload mismatch');
	}
	if (family === 'repeat_offenders') {
		const repeat = raw.value as HistoricRepeatOffendersDay;
		if ((repeat.by_grain ?? []).some((grain) => grain.window_end !== date)) {
			throw new HistoryArtifactContractError(
				ref.path,
				'advertised repeat-offender grain endpoint mismatch',
			);
		}
	}
	return raw.value;
}

export function getHotspotsHistoryIndex(ctx?: AdapterCtx): Promise<HistoricCollectionIndex | null> {
	return getPointHistoryIndex('hotspots', ctx);
}

export function getRepeatOffendersHistoryIndex(
	ctx?: AdapterCtx,
): Promise<HistoricCollectionIndex | null> {
	return getPointHistoryIndex('repeat_offenders', ctx);
}

export function getHotspotsHistoryDay(
	date: string,
	index: HistoricCollectionIndex,
	ctx?: AdapterCtx,
): Promise<HistoricHotspotsDay> {
	return getPointHistoryDay('hotspots', date, index, ctx);
}

export function getRepeatOffendersHistoryDay(
	date: string,
	index: HistoricCollectionIndex,
	ctx?: AdapterCtx,
): Promise<HistoricRepeatOffendersDay> {
	return getPointHistoryDay('repeat_offenders', date, index, ctx);
}
