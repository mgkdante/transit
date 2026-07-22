import { HistoryArtifactContractError } from '$lib/v1/history/partitions';
import { sha256Hex, type RawJsonEntity } from '$lib/v1/http';
import type { AdapterCtx } from '$lib/v1/adapter';
import type { HistoricPartitionRef } from '$lib/v1/schemas';

export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function historyRootPath(): string {
	return 'historic/history/index.json';
}

export function abortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

export function freshHistoryCtx(ctx?: AdapterCtx): AdapterCtx {
	return { ...ctx, freshHistoryParent: true };
}

export async function verifyPartitionBytes<T>(
	ref: HistoricPartitionRef,
	raw: RawJsonEntity<T>,
): Promise<void> {
	if (raw.bytes.byteLength !== ref.byte_size) {
		throw new HistoryArtifactContractError(ref.path, 'advertised partition byte size mismatch');
	}
	const digest = await sha256Hex(raw.bytes);
	if (digest !== ref.sha256) {
		throw new HistoryArtifactContractError(ref.path, 'advertised partition SHA-256 mismatch');
	}
}
