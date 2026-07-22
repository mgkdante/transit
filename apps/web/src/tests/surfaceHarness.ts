export interface StoragePort {
	readonly length: number;
	key(index: number): string | null;
	removeItem(key: string): void;
}

export interface StorageScope {
	readonly port: StoragePort;
	readonly keys?: readonly string[];
	readonly prefixes?: readonly string[];
}

export interface SurfaceHarnessOptions<TMountArgs extends unknown[], TMountResult, TLocale> {
	readonly url?: {
		readonly initial: string | URL;
		readonly origin?: string | URL;
		readonly set: (url: URL) => void;
	};
	readonly locale?: {
		readonly initial: TLocale;
		readonly set: (locale: TLocale) => void;
	};
	readonly storage?: readonly StorageScope[];
	readonly resetters?: readonly (() => void)[];
	readonly mount: (...args: TMountArgs) => TMountResult;
}

export interface SurfaceHarness<TMountArgs extends unknown[], TMountResult> {
	readonly mount: (...args: TMountArgs) => TMountResult;
	reset(): void;
	setUrl(value: string | URL): URL;
}

function clearStorage(scope: StorageScope): void {
	const exactKeys = new Set(scope.keys ?? []);
	const prefixes = scope.prefixes ?? [];
	const storedKeys = Array.from({ length: scope.port.length }, (_, index) => scope.port.key(index));

	for (const key of storedKeys) {
		if (key != null && (exactKeys.has(key) || prefixes.some((prefix) => key.startsWith(prefix)))) {
			scope.port.removeItem(key);
		}
	}
}

export function createSurfaceHarness<TMountArgs extends unknown[], TMountResult, TLocale = never>(
	options: SurfaceHarnessOptions<TMountArgs, TMountResult, TLocale>,
): SurfaceHarness<TMountArgs, TMountResult> {
	const normalizeUrl = (value: string | URL): URL => {
		const origin = options.url?.origin;
		return new URL(value, origin);
	};

	const setUrl = (value: string | URL): URL => {
		if (options.url == null) throw new Error('This surface harness has no URL adapter.');
		const url = normalizeUrl(value);
		options.url.set(url);
		return url;
	};

	return {
		mount: options.mount,
		reset() {
			if (options.url != null) setUrl(options.url.initial);
			if (options.locale != null) options.locale.set(options.locale.initial);
			for (const scope of options.storage ?? []) clearStorage(scope);
			for (const resetter of options.resetters ?? []) resetter();
		},
		setUrl,
	};
}
