import type { AdapterCtx } from './adapter';
import { bindingFetch, r2BucketFetch } from './binding';

const SERVER_V1_DEADLINE_MS = 10_000;

export interface IdentitySeed {
	id: string;
	name: string;
}

interface ServerV1Event {
	fetch: typeof fetch;
	locals: { v1Cache?: Map<string, unknown> };
	platform?: App.Platform;
	url: URL;
}

function isCancellationError(error: unknown): boolean {
	const name = error instanceof DOMException || error instanceof Error ? error.name : undefined;
	return name === 'AbortError' || name === 'TimeoutError';
}

function callerSignal(
	input: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
): AbortSignal | undefined {
	if (init?.signal !== undefined) return init.signal ?? undefined;
	return input instanceof Request ? input.signal : undefined;
}

async function withServerV1Deadline(
	input: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
	run: (deadlineInit: RequestInit, signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
	const upstreamSignal = callerSignal(input, init);
	if (upstreamSignal?.aborted) throw upstreamSignal.reason;

	const controller = new AbortController();
	let rejectAbort!: (reason?: unknown) => void;
	const abortPromise = new Promise<never>((_resolve, reject) => {
		rejectAbort = reject;
	});
	const abortWith = (reason: unknown): void => {
		if (controller.signal.aborted) return;
		rejectAbort(reason);
		controller.abort(reason);
	};
	const handleUpstreamAbort = (): void => {
		abortWith(upstreamSignal?.reason);
	};
	upstreamSignal?.addEventListener('abort', handleUpstreamAbort, { once: true });
	const deadlineTimer = setTimeout(() => {
		abortWith(
			new DOMException(
				`Server v1 fetch exceeded its ${SERVER_V1_DEADLINE_MS}ms deadline`,
				'TimeoutError',
			),
		);
	}, SERVER_V1_DEADLINE_MS);

	try {
		const deadlineInit: RequestInit = { ...init, signal: controller.signal };
		return await Promise.race([run(deadlineInit, controller.signal), abortPromise]);
	} finally {
		clearTimeout(deadlineTimer);
		upstreamSignal?.removeEventListener('abort', handleUpstreamAbort);
	}
}

/** Build the per-request repository context for server loaders. */
export function serverV1Context(event: ServerV1Event): AdapterCtx {
	const snapshots = event.platform?.env?.SNAPSHOTS;
	const binding = event.platform?.env?.DATA;
	const compatibilityFetch = binding ? bindingFetch(binding, event.url.origin) : null;
	const directFetch = snapshots ? r2BucketFetch(snapshots, event.url.origin) : null;
	const snapshotFetch: typeof fetch = async (input, init) =>
		withServerV1Deadline(input, init, async (deadlineInit, signal) => {
			if (directFetch) {
				try {
					return await directFetch(input, deadlineInit);
				} catch (error) {
					if (signal.aborted) throw signal.reason;
					if (isCancellationError(error) || !compatibilityFetch) throw error;
					return compatibilityFetch(input, deadlineInit);
				}
			}
			return (compatibilityFetch ?? event.fetch)(input, deadlineInit);
		});
	return {
		fetch: snapshotFetch,
		cache: event.locals.v1Cache,
	};
}
