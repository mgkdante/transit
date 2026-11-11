import { browser } from '$app/env';
import { tick } from 'svelte';

export const REFRESH_INVALIDATE_TIMEOUT_MS = 8_000;

let epoch = $state(0);
let refreshing = $state(false);
let error = $state<Error | null>(null);
let runVersion = 0;
let inFlight: Promise<void> | null = null;
const activeWork = new Map<Promise<unknown>, Promise<void>>();
let failures: unknown[] = [];

function track(pending: Promise<unknown>, signal?: AbortSignal): void {
	if (!browser || signal?.aborted || activeWork.has(pending)) return;
	let settle!: () => void;
	activeWork.set(
		pending,
		new Promise<void>((resolve) => {
			settle = resolve;
		}),
	);
	let finished = false;
	const finish = (reason?: unknown, failed = false) => {
		if (finished) return;
		finished = true;
		signal?.removeEventListener('abort', aborted);
		activeWork.delete(pending);
		if (failed && refreshing && !signal?.aborted) failures.push(reason);
		settle();
	};
	const aborted = () => finish();
	signal?.addEventListener('abort', aborted, { once: true });
	void pending.then(
		() => finish(),
		(reason) => finish(reason, true),
	);
}

async function settleWork(version: number): Promise<void> {
	while (version === runVersion) {
		await tick();
		if (!activeWork.size) return;
		await Promise.all(activeWork.values());
	}
}

async function executeRefresh(): Promise<void> {
	const version = ++runVersion;
	refreshing = true;
	error = null;
	failures = [];
	epoch += 1;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const refresh = async () => {
		await tick();
		const { invalidateAll } = await import('$app/navigation');
		await invalidateAll();
		await settleWork(version);
		await tick();
	};
	try {
		await Promise.race([
			refresh(),
			new Promise<never>((_resolve, reject) => {
				timeoutId = setTimeout(
					() => reject(new Error('Data refresh timed out')),
					REFRESH_INVALIDATE_TIMEOUT_MS,
				);
			}),
		]);
		if (failures.length) throw failures[0];
	} catch (reason) {
		error = reason instanceof Error ? reason : new Error(String(reason));
	} finally {
		clearTimeout(timeoutId);
		runVersion += 1;
		refreshing = false;
	}
}

export const dataRefresh = {
	get epoch(): number {
		return epoch;
	},
	get refreshing(): boolean {
		return refreshing;
	},
	get error(): Error | null {
		return error;
	},
	track,
	bumpEpoch(): void {
		if (!browser) return;
		epoch += 1;
	},
	run(): Promise<void> {
		if (!browser) return Promise.resolve();
		if (inFlight) return inFlight;
		const pending = executeRefresh().finally(() => {
			inFlight = null;
		});
		inFlight = pending;
		return pending;
	},
};
