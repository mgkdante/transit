export interface CleanupReleaseResult {
	readonly pending: readonly (() => void)[];
	readonly errors: readonly unknown[];
}

export interface MapOwnerReleaseResult<TMotion> {
	readonly motion: TMotion | null;
	readonly disposers: readonly (() => void)[];
	readonly emphasisPending: boolean;
	readonly errors: readonly unknown[];
}

export function reportCleanupFailure(message: string, error: unknown): void {
	try {
		console.error(message, error);
	} catch {
		try {
			globalThis.reportError?.(error);
		} catch {
			// A broken fallback reporter cannot reopen component destruction.
		}
	}
}

export function releaseWithRetry(dispose: () => void, report: (error: unknown) => void): void {
	try {
		dispose();
		return;
	} catch (error) {
		try {
			dispose();
		} catch (retryError) {
			report(new AggregateError([error, retryError], 'Map cleanup retry failed'));
			return;
		}
		report(error);
	}
}

export function releaseCleanupReceipts(
	disposers: readonly (() => void)[],
	passes = 1,
): CleanupReleaseResult {
	let pending = [...disposers];
	const errors: unknown[] = [];
	for (let pass = 0; pass < passes && pending.length > 0; pass += 1) {
		const retained: Array<() => void> = [];
		for (const dispose of pending) {
			try {
				dispose();
			} catch (error) {
				errors.push(error);
				retained.push(dispose);
			}
		}
		pending = retained;
	}
	return { pending, errors };
}

export function installCleanupReceipts(
	install: () => readonly (() => void)[],
	onFailure: (disposers: readonly (() => void)[]) => void,
): readonly (() => void)[] {
	try {
		return install();
	} catch (error) {
		onFailure((error as { readonly disposers?: readonly (() => void)[] }).disposers ?? []);
		throw error;
	}
}

export function releaseMapOwnerReceipts<TMotion extends { destroy(): void }>(
	motion: TMotion | null,
	disposers: readonly (() => void)[],
	clearEmphasis: () => void,
): MapOwnerReleaseResult<TMotion> {
	let pendingMotion = motion;
	let pendingDisposers = [...disposers];
	let emphasisPending = true;
	const errors: unknown[] = [];
	for (let pass = 0; pass < 2; pass += 1) {
		if (pendingMotion) {
			try {
				pendingMotion.destroy();
				pendingMotion = null;
			} catch (error) {
				errors.push(error);
			}
		}
		const released = releaseCleanupReceipts(pendingDisposers);
		pendingDisposers = [...released.pending];
		errors.push(...released.errors);
		if (emphasisPending) {
			try {
				clearEmphasis();
				emphasisPending = false;
			} catch (error) {
				errors.push(error);
			}
		}
		if (!pendingMotion && pendingDisposers.length === 0 && !emphasisPending) break;
	}
	return { motion: pendingMotion, disposers: pendingDisposers, emphasisPending, errors };
}

export function throwCleanupErrors(errors: readonly unknown[], message: string): void {
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, message);
}
