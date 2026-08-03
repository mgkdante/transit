export type MapOwnerCleanupRelease = () => void | PromiseLike<unknown>;
export type MapOwnerCleanupReceipt =
	| MapOwnerCleanupRelease
	| { readonly release: MapOwnerCleanupRelease; readonly retry: false };
export type MapOwnerCleanupReporter = (error: unknown) => unknown;

export interface MapDisposalRegistry {
	readonly disposed: boolean;
	readonly size: number;
	own(release: MapOwnerCleanupRelease, options?: { readonly retry?: boolean }): () => void;
	dispose(): void;
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

function reportBoundaryFailure(
	owner: string,
	error: unknown,
	report: MapOwnerCleanupReporter,
): void {
	try {
		const result = report(error);
		if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
			void Promise.resolve(result).catch((reporterError) =>
				reportCleanupFailure(
					`${owner} cleanup reporter failed`,
					new AggregateError([error, reporterError], `${owner} cleanup reporter failed`),
				),
			);
		}
	} catch (reporterError) {
		reportCleanupFailure(
			`${owner} cleanup reporter failed`,
			new AggregateError([error, reporterError], `${owner} cleanup reporter failed`),
		);
	}
}

export function mapOwnerBoundary(
	owner: string,
	receipts: readonly MapOwnerCleanupReceipt[],
	reporter: MapOwnerCleanupReporter = (error) =>
		reportCleanupFailure(`${owner} cleanup failed`, error),
): () => void {
	const ownedReceipts = receipts.map((receipt) =>
		typeof receipt === 'function' ? { release: receipt, retry: true } : receipt,
	);
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		const failures = ownedReceipts.map(() => [] as unknown[]);
		let pending = ownedReceipts.map((_, index) => index);
		for (let pass = 0; pass < 2 && pending.length > 0; pass += 1) {
			const retry: number[] = [];
			for (const index of pending) {
				try {
					const result = ownedReceipts[index].release();
					if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
						void Promise.resolve(result).catch((error) =>
							reportBoundaryFailure(owner, error, reporter),
						);
					}
				} catch (error) {
					failures[index].push(error);
					if (ownedReceipts[index].retry) retry.push(index);
				}
			}
			pending = retry;
		}

		for (const errors of failures) {
			if (errors.length === 0) continue;
			reportBoundaryFailure(
				owner,
				errors.length === 1
					? errors[0]
					: new AggregateError(errors, `${owner} cleanup step failed`),
				reporter,
			);
		}
	};
}

export function createMapDisposalRegistry(
	owner: string,
	reporter: MapOwnerCleanupReporter = (error) =>
		reportCleanupFailure(`${owner} cleanup failed`, error),
): MapDisposalRegistry {
	type OwnedReceipt = {
		active: boolean;
		readonly retry: boolean;
		readonly release: MapOwnerCleanupRelease;
		readonly dispose: MapOwnerCleanupRelease;
	};
	const receipts: OwnedReceipt[] = [];
	let disposed = false;

	function own(
		release: MapOwnerCleanupRelease,
		options: { readonly retry?: boolean } = {},
	): () => void {
		const retry = options.retry !== false;
		const receipt: OwnedReceipt = {
			active: true,
			retry,
			release,
			dispose: () => {
				if (!receipt.active) return;
				let result: void | PromiseLike<unknown>;
				try {
					result = receipt.release();
				} catch (error) {
					if (!receipt.retry) receipt.active = false;
					throw error;
				}
				if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
					return Promise.resolve(result).then(
						() => {
							receipt.active = false;
						},
						(error) => {
							if (!receipt.retry) receipt.active = false;
							throw error;
						},
					);
				}
				receipt.active = false;
			},
		};
		if (disposed) {
			mapOwnerBoundary(
				owner,
				[retry ? receipt.dispose : { release: receipt.dispose, retry: false }],
				reporter,
			)();
			return () => {};
		}
		receipts.push(receipt);
		return mapOwnerBoundary(
			owner,
			[retry ? receipt.dispose : { release: receipt.dispose, retry: false }],
			reporter,
		);
	}

	return {
		get disposed() {
			return disposed;
		},
		get size() {
			return receipts.filter((receipt) => receipt.active).length;
		},
		own,
		dispose() {
			disposed = true;
			const active = receipts
				.filter((receipt) => receipt.active)
				.map(
					(receipt): MapOwnerCleanupReceipt =>
						receipt.retry ? receipt.dispose : { release: receipt.dispose, retry: false },
				);
			mapOwnerBoundary(owner, active, reporter)();
		},
	};
}
