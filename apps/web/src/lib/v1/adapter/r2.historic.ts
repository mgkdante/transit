import type { z } from 'zod';
import { resolveUrl } from '$lib/v1/config';
import { getEntityJson, getEntityJsonWithBytes, sha256Hex } from '$lib/v1/http';
import { HistoricHotspotsDaySchema, HotspotsSchema } from '$lib/v1/schemas/hotspots';
import {
	HistoricRepeatOffendersDaySchema,
	RepeatOffendersSchema,
} from '$lib/v1/schemas/repeat_offenders';
import { AlertHistorySchema } from '$lib/v1/schemas/alert_history';
import { ReceiptsIndexSchema } from '$lib/v1/schemas/receipts_index';
import { RouteReliabilityIndexSchema } from '$lib/v1/schemas/route_reliability_index';
import { ReceiptSchema } from '$lib/v1/schemas/receipts';
import { RouteReliabilitySchema } from '$lib/v1/schemas/route_reliability';
import { StopReliabilitySchema } from '$lib/v1/schemas/stop_reliability';
import { ProvenanceSchema } from '$lib/v1/schemas/provenance';
import { NetworkTrendSchema } from '$lib/v1/schemas/network_trend';
import { AlertArchiveIndexSchema, AlertArchivePageSchema } from '$lib/v1/schemas/alert_archive';
import {
	HistoricAvailabilityIndexSchema,
	HistoricCollectionIndexSchema,
	HistoricEntityDirectoryIndexSchema,
	LineHistoryPartitionSchema,
	NetworkHistoryPartitionSchema,
	StopHistoryPartitionSchema,
} from '$lib/v1/schemas/history';
import {
	HistoryArtifactContractError,
	assertSafeHistoryArtifactPath,
} from '$lib/v1/history/partitions';
import { encodeHistoryEntityId } from '$lib/v1/history/entity';
import {
	historyPointerPayloadSha,
	isHistoryEntityIndexPath,
	isHistoryFamilyIndexPath,
	isHistoryPointArtifactPath,
} from '$lib/v1/history/pointers';
import type { AdapterCtx, HistoricPort, ProvenancePort } from './types';
import {
	R2_DEFAULTS as DEFAULTS,
	IMMUTABLE_CACHE,
	MUTABLE_CACHE,
	fetchOf,
	loadManifest,
	readEntity,
	readOptionalWhole,
	readWhole,
} from './r2.core';

let historyRefreshSequence = 0;

function freshHistoryUrl(path: string, fresh: boolean | undefined): string {
	const url = resolveUrl(path);
	if (!fresh) return url;
	historyRefreshSequence += 1;
	const token = `${Date.now().toString(36)}-${historyRefreshSequence.toString(36)}`;
	return `${url}?history_refresh=${encodeURIComponent(token)}`;
}

async function readOptionalHistory<T>(
	path: string,
	schema: z.ZodType<T>,
	label: string,
	ctx?: AdapterCtx,
): Promise<T | null> {
	const url = freshHistoryUrl(path, ctx?.freshHistoryParent);
	const expectedSha = historyPointerPayloadSha(path);
	const init = {
		cache: ctx?.freshHistoryParent
			? ('reload' as const)
			: expectedSha === null
				? MUTABLE_CACHE
				: IMMUTABLE_CACHE,
		signal: ctx?.signal,
	};
	if (expectedSha !== null) {
		const raw = await getEntityJsonWithBytes(url, schema, label, fetchOf(ctx), init);
		if (raw === undefined) return null;
		if ((await sha256Hex(raw.bytes)) !== expectedSha) {
			throw new HistoryArtifactContractError(path, 'advertised pointer payload SHA-256 mismatch');
		}
		return raw.value;
	}
	const value = await getEntityJson(url, schema, label, fetchOf(ctx), init);
	return value ?? null;
}

function assertHistoryFamilyIndexPath(family: 'network' | 'lines' | 'stops', path: string): string {
	if (!isHistoryFamilyIndexPath(family, path)) {
		throw new HistoryArtifactContractError(path, `unsafe advertised ${family} history index path`);
	}
	return path;
}

function assertPointHistoryIndexPath(
	family: 'hotspots' | 'repeat_offenders',
	path: string,
): string {
	if (!isHistoryFamilyIndexPath(family, path)) {
		throw new HistoryArtifactContractError(path, `unsafe advertised ${family} history index path`);
	}
	return path;
}

function assertPointHistoryDayPath(
	family: 'hotspots' | 'repeat_offenders',
	date: string,
	path: string,
): string {
	if (!isHistoryPointArtifactPath(family, date, path)) {
		throw new HistoryArtifactContractError(path, `unsafe advertised ${family} history day path`);
	}
	return path;
}

function assertHistoryEntityIndexPath(
	family: 'lines' | 'stops',
	entityId: string,
	path: string,
): string {
	if (!isHistoryEntityIndexPath(family, entityId, path)) {
		throw new HistoryArtifactContractError(path, `unsafe advertised ${family} entity index path`);
	}
	return path;
}

function assertFamilyPartitionPath(
	family: 'network' | 'lines' | 'stops',
	entityId: string | null,
	path: string,
): string {
	const encoded = family === 'network' ? '' : `${encodeHistoryEntityId(entityId ?? '')}/`;
	const pattern = new RegExp(
		`^historic/history/${family}/${encoded}generations/[0-9a-f]{64}/\\d{4}-(?:0[1-9]|1[0-2])\\.json$`,
	);
	if (!pattern.test(path)) {
		throw new HistoryArtifactContractError(path, `unsafe advertised ${family} history path`);
	}
	return path;
}

async function readRawHistoryPartition<T>(
	path: string,
	schema: z.ZodType<T>,
	label: string,
	ctx?: AdapterCtx,
) {
	const value = await getEntityJsonWithBytes(resolveUrl(path), schema, label, fetchOf(ctx), {
		cache: IMMUTABLE_CACHE,
		signal: ctx?.signal,
	});
	return value ?? null;
}

export const historicPort: HistoricPort = {
	historyIndex: (ctx) =>
		readOptionalHistory(
			DEFAULTS.historic.history_index,
			HistoricAvailabilityIndexSchema,
			'historic.historyIndex',
			ctx,
		),
	networkHistoryIndex: async (path, ctx) =>
		readOptionalHistory(
			assertHistoryFamilyIndexPath('network', path),
			HistoricCollectionIndexSchema,
			'historic.networkHistoryIndex',
			ctx,
		),
	hotspotsHistoryIndex: async (path, ctx) =>
		readOptionalHistory(
			assertPointHistoryIndexPath('hotspots', path),
			HistoricCollectionIndexSchema,
			'historic.hotspotsHistoryIndex',
			ctx,
		),
	repeatOffendersHistoryIndex: async (path, ctx) =>
		readOptionalHistory(
			assertPointHistoryIndexPath('repeat_offenders', path),
			HistoricCollectionIndexSchema,
			'historic.repeatOffendersHistoryIndex',
			ctx,
		),
	lineHistoryDirectory: async (path, ctx) =>
		readOptionalHistory(
			assertHistoryFamilyIndexPath('lines', path),
			HistoricEntityDirectoryIndexSchema,
			'historic.lineHistoryDirectory',
			ctx,
		),
	stopHistoryDirectory: async (path, ctx) =>
		readOptionalHistory(
			assertHistoryFamilyIndexPath('stops', path),
			HistoricEntityDirectoryIndexSchema,
			'historic.stopHistoryDirectory',
			ctx,
		),
	lineHistoryIndex: async (entityId, path, ctx) =>
		readOptionalHistory(
			assertHistoryEntityIndexPath('lines', entityId, path),
			HistoricCollectionIndexSchema,
			'historic.lineHistoryIndex',
			ctx,
		),
	stopHistoryIndex: async (entityId, path, ctx) =>
		readOptionalHistory(
			assertHistoryEntityIndexPath('stops', entityId, path),
			HistoricCollectionIndexSchema,
			'historic.stopHistoryIndex',
			ctx,
		),
	networkHistoryPartition: async (path, ctx) =>
		readRawHistoryPartition(
			assertFamilyPartitionPath('network', null, path),
			NetworkHistoryPartitionSchema,
			'historic.networkHistoryPartition',
			ctx,
		),
	lineHistoryPartition: async (entityId, path, ctx) =>
		readRawHistoryPartition(
			assertFamilyPartitionPath('lines', entityId, path),
			LineHistoryPartitionSchema,
			'historic.lineHistoryPartition',
			ctx,
		),
	stopHistoryPartition: async (entityId, path, ctx) =>
		readRawHistoryPartition(
			assertFamilyPartitionPath('stops', entityId, path),
			StopHistoryPartitionSchema,
			'historic.stopHistoryPartition',
			ctx,
		),
	hotspotsHistoryDay: async (date, path, ctx) =>
		readRawHistoryPartition(
			assertPointHistoryDayPath('hotspots', date, path),
			HistoricHotspotsDaySchema,
			'historic.hotspotsHistoryDay',
			ctx,
		),
	repeatOffendersHistoryDay: async (date, path, ctx) =>
		readRawHistoryPartition(
			assertPointHistoryDayPath('repeat_offenders', date, path),
			HistoricRepeatOffendersDaySchema,
			'historic.repeatOffendersHistoryDay',
			ctx,
		),
	alertArchiveIndex: async (ctx) => {
		const manifest = await loadManifest(ctx);
		return readOptionalWhole(
			manifest.files.historic?.alerts_index ?? DEFAULTS.historic.alerts_index,
			AlertArchiveIndexSchema,
			'historic.alertArchiveIndex',
			ctx,
		);
	},
	alertArchivePage: async (path, ctx) => {
		const safePath = assertSafeHistoryArtifactPath(path);
		const url = resolveUrl(safePath);
		const value = await getEntityJson(
			url,
			AlertArchivePageSchema,
			'historic.alertArchivePage',
			fetchOf(ctx),
			{ cache: IMMUTABLE_CACHE, signal: ctx?.signal, serverErrorRetries: 1 },
		);
		return value ?? null;
	},
	networkTrend: async (ctx) => {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.historic?.network_trend ?? DEFAULTS.historic.network_trend,
			NetworkTrendSchema,
			'historic.networkTrend',
			MUTABLE_CACHE,
			ctx,
		);
	},
	hotspots: async (ctx) => {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.historic?.hotspots ?? DEFAULTS.historic.hotspots,
			HotspotsSchema,
			'historic.hotspots',
			MUTABLE_CACHE,
			ctx,
		);
	},
	repeatOffenders: async (ctx) => {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.historic?.repeat_offenders ?? DEFAULTS.historic.repeat_offenders,
			RepeatOffendersSchema,
			'historic.repeatOffenders',
			MUTABLE_CACHE,
			ctx,
		);
	},
	alertHistory: async (ctx) => {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.historic?.alert_history ?? DEFAULTS.historic.alert_history,
			AlertHistorySchema,
			'historic.alertHistory',
			MUTABLE_CACHE,
			ctx,
		);
	},
	receiptsIndex: async (ctx) => {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.historic?.receipts_index ?? DEFAULTS.historic.receipts_index,
			ReceiptsIndexSchema,
			'historic.receiptsIndex',
			MUTABLE_CACHE,
			ctx,
		);
	},
	routeReliabilityIndex: async (ctx) => {
		const manifest = await loadManifest(ctx);
		const url = resolveUrl(
			manifest.files.historic?.route_reliability_index ?? DEFAULTS.historic.route_reliability_index,
		);
		const value = await getEntityJson(
			url,
			RouteReliabilityIndexSchema,
			'historic.routeReliabilityIndex',
			fetchOf(ctx),
			{ cache: MUTABLE_CACHE, signal: ctx?.signal },
		);
		return value ?? null;
	},
	receipt: async (date, ctx) => {
		const manifest = await loadManifest(ctx);
		return readEntity(
			'historic',
			manifest.files.historic?.receipts_prefix ?? DEFAULTS.historic.receipts_prefix,
			date,
			ReceiptSchema,
			'historic.receipt',
			MUTABLE_CACHE,
			ctx,
		);
	},
	routeReliability: async (routeId, ctx) => {
		const manifest = await loadManifest(ctx);
		return readEntity(
			'historic',
			manifest.files.historic?.route_reliability_prefix ??
				DEFAULTS.historic.route_reliability_prefix,
			routeId,
			RouteReliabilitySchema,
			'historic.routeReliability',
			MUTABLE_CACHE,
			ctx,
		);
	},
	stopReliability: async (stopId, ctx) => {
		const manifest = await loadManifest(ctx);
		return readEntity(
			'historic',
			manifest.files.historic?.stop_reliability_prefix ?? DEFAULTS.historic.stop_reliability_prefix,
			stopId,
			StopReliabilitySchema,
			'historic.stopReliability',
			MUTABLE_CACHE,
			ctx,
		);
	},
};

export const provenancePort: ProvenancePort = {
	async get(ctx?: AdapterCtx) {
		const manifest = await loadManifest(ctx);
		return readWhole(
			manifest.files.historic?.provenance ?? DEFAULTS.provenance,
			ProvenanceSchema,
			'provenance',
			MUTABLE_CACHE,
			ctx,
		);
	},
};
