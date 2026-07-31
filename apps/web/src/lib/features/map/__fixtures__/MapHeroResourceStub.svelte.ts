interface ResourceOptions {
	readonly enabled?: () => boolean;
	readonly key?: () => unknown;
}

export function createMapHeroResourceStub<T>(
	loader: (signal: AbortSignal) => T | Promise<T>,
	options: ResourceOptions = {},
) {
	let data = $state<T | null>(null);
	let error = $state<Error | null>(null);
	let loading = $state(false);
	let settled = $state(false);
	let manual = $state(0);
	let sequence = 0;

	$effect(() => {
		void manual;
		options.key?.();
		if (options.enabled?.() === false) {
			data = null;
			error = null;
			loading = false;
			settled = false;
			return;
		}

		const token = ++sequence;
		const controller = new AbortController();
		loading = true;
		error = null;

		const result = loader(controller.signal);
		if (!(result instanceof Promise)) {
			data = result;
			loading = false;
			settled = true;
			return () => {
				sequence += 1;
				controller.abort();
			};
		}

		result
			.then((value) => {
				if (token === sequence) data = value;
			})
			.catch((reason: unknown) => {
				if (token !== sequence || controller.signal.aborted) return;
				error = reason instanceof Error ? reason : new Error(String(reason));
			})
			.finally(() => {
				if (token !== sequence) return;
				loading = false;
				settled = true;
			});

		return () => {
			sequence += 1;
			controller.abort();
		};
	});

	return {
		get data() {
			return data;
		},
		get error() {
			return error;
		},
		get loading() {
			return loading;
		},
		get settled() {
			return settled;
		},
		reload() {
			manual += 1;
		},
	};
}
