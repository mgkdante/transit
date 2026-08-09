/** Dependency-free runtime ports supplied by the app at client startup. */
export interface ClockPort {
	readonly serverNow: number;
	noteServerEpochMs(serverEpochMs: number): void;
	subscribe(): () => void;
}

export interface RefreshPort {
	readonly epoch: number;
	noteDataGeneratedUtc(generatedUtc: string | null | undefined): void;
}

export interface V1RuntimePorts {
	readonly clock: ClockPort;
	readonly refresh: RefreshPort;
}

const fallbackRuntime: V1RuntimePorts = {
	clock: {
		get serverNow() {
			return Date.now();
		},
		noteServerEpochMs: () => {},
		subscribe: () => () => {},
	},
	refresh: {
		get epoch() {
			return 0;
		},
		noteDataGeneratedUtc: () => {},
	},
};

let runtime = fallbackRuntime;

export function getV1Runtime(): V1RuntimePorts {
	return runtime;
}

export function configureV1Runtime(next: Partial<V1RuntimePorts>): () => void {
	const previous = runtime;
	const configured: V1RuntimePorts = {
		clock: next.clock ?? previous.clock,
		refresh: next.refresh ?? previous.refresh,
	};
	runtime = configured;
	return () => {
		if (runtime === configured) runtime = previous;
	};
}
