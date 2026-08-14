export class EnteringIntersectionObserver implements IntersectionObserver {
	readonly root: Element | Document | null;
	readonly rootMargin: string;
	readonly thresholds: readonly number[];
	private readonly targets = new Set<Element>();

	constructor(
		private readonly callback: IntersectionObserverCallback,
		options: IntersectionObserverInit = {},
	) {
		this.root = options.root ?? null;
		this.rootMargin = options.rootMargin ?? '0px';
		this.thresholds = Array.isArray(options.threshold)
			? options.threshold
			: [options.threshold ?? 0];
	}

	observe(target: Element): void {
		this.targets.add(target);
		queueMicrotask(() => {
			if (!this.targets.has(target)) return;
			this.callback(
				[{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
				this,
			);
		});
	}

	unobserve(target: Element): void {
		this.targets.delete(target);
	}

	disconnect(): void {
		this.targets.clear();
	}

	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}
