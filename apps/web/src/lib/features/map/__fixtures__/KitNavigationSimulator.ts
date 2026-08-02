export type SimulatedNavigationType = 'goto' | 'link' | 'popstate';

export interface SimulatedNavigation {
	readonly token: number;
	readonly from: { readonly url: URL } | null;
	readonly to: { readonly url: URL } | null;
	readonly type: SimulatedNavigationType;
	readonly delta?: number;
	readonly keepFocus: boolean;
	readonly complete: Promise<void>;
	readonly fulfil: () => void;
	readonly reject: (error: Error) => void;
}

export type SimulatedBeforeNavigation = SimulatedNavigation & { readonly cancel: () => void };
export type SimulatedNavigationCallback = (navigation: SimulatedNavigation) => unknown;

export interface KitNavigationSimulatorAdapter {
	readonly publishPage: (href: string, state: Readonly<Record<string, unknown>>) => void;
	readonly publishNavigating: (navigation: SimulatedNavigation | null) => void;
	readonly settled: () => Promise<void>;
	readonly tick: () => Promise<void>;
	readonly activeElement: () => unknown;
	readonly bodyElement: () => unknown;
	readonly resetFocus: (url: URL) => void;
}

export interface StartNavigationOptions {
	readonly type?: SimulatedNavigationType;
	readonly delta?: number;
	readonly keepFocus?: boolean;
	readonly redirect?: boolean;
}

export class KitNavigationSimulator {
	readonly acceptedPublications: Array<Readonly<{ href: string; flushRevision: number }>> = [];
	readonly beforeNavigateCallbacks = new Set<(navigation: SimulatedBeforeNavigation) => void>();
	readonly onNavigateCallbacks = new Set<SimulatedNavigationCallback>();
	readonly afterNavigateCallbacks = new Set<SimulatedNavigationCallback>();

	activeNavigation: SimulatedNavigation | null = null;
	currentPageHref = 'http://localhost/map';
	flushRevision = 0;
	#nextNavigationToken = 0;
	#pendingNavigations = new Set<SimulatedNavigation>();

	constructor(private readonly adapter: KitNavigationSimulatorAdapter) {}

	setPageUrl(href: string, state: Readonly<Record<string, unknown>> = {}): void {
		this.currentPageHref = new URL(href, this.currentPageHref).href;
		this.adapter.publishPage(this.currentPageHref, state);
	}

	beforeNavigate(callback: (navigation: SimulatedBeforeNavigation) => void): () => void {
		this.beforeNavigateCallbacks.add(callback);
		return () => this.beforeNavigateCallbacks.delete(callback);
	}

	onNavigate(callback: SimulatedNavigationCallback): () => void {
		this.onNavigateCallbacks.add(callback);
		return () => this.onNavigateCallbacks.delete(callback);
	}

	afterNavigate(callback: SimulatedNavigationCallback): () => void {
		this.afterNavigateCallbacks.add(callback);
		return () => this.afterNavigateCallbacks.delete(callback);
	}

	startNavigation(
		href: string,
		from = this.currentPageHref,
		options: StartNavigationOptions = {},
	): {
		readonly accepted: boolean;
		readonly beforeNavigateDelivered: boolean;
		readonly navigation: SimulatedNavigation;
	} {
		const redirected = options.redirect ? this.activeNavigation : null;
		let fulfil!: () => void;
		let reject!: (error: Error) => void;
		const complete = redirected
			? redirected.complete
			: new Promise<void>((resolve, fail) => {
					fulfil = resolve;
					reject = fail;
				});
		if (redirected) {
			fulfil = redirected.fulfil;
			reject = redirected.reject;
		} else {
			// Kit rejects cancellation/supersession. Keep the simulator faithful without
			// turning an intentionally unobserved app goto into test-runner noise.
			void complete.catch(() => {});
		}
		const navigation: SimulatedNavigation = {
			token: redirected ? redirected.token : ++this.#nextNavigationToken,
			from: { url: new URL(from) },
			to: { url: new URL(href, from) },
			type: options.type ?? redirected?.type ?? 'goto',
			...(options.delta == null ? {} : { delta: options.delta }),
			keepFocus: redirected ? redirected.keepFocus : (options.keepFocus ?? false),
			complete,
			fulfil,
			reject,
		};

		const beforeNavigateDelivered = this.activeNavigation == null;
		let cancelled = false;
		if (beforeNavigateDelivered) {
			const cancellable: SimulatedBeforeNavigation = {
				...navigation,
				cancel: () => {
					cancelled = true;
				},
			};
			for (const callback of this.beforeNavigateCallbacks) callback(cancellable);
		}
		if (cancelled) {
			navigation.reject(new Error('navigation cancelled'));
			return { accepted: false, beforeNavigateDelivered, navigation };
		}
		this.activeNavigation = navigation;
		this.#pendingNavigations.add(navigation);
		this.acceptedPublications.push({
			href: navigation.to!.url.href,
			flushRevision: this.flushRevision,
		});
		this.adapter.publishNavigating(navigation);
		return { accepted: true, beforeNavigateDelivered, navigation };
	}

	async flushEffects(): Promise<void> {
		await this.adapter.tick();
		this.flushRevision += 1;
	}

	reachLoadCheckpoint(navigation: SimulatedNavigation): boolean {
		if (this.activeNavigation?.token === navigation.token) return true;
		navigation.reject(new Error('navigation aborted'));
		this.#pendingNavigations.delete(navigation);
		return false;
	}

	async commitNavigation(committedHref: string): Promise<SimulatedNavigation> {
		const navigation = this.activeNavigation;
		if (!navigation) throw new Error('expected an active navigation');
		const committedUrl = new URL(committedHref, this.currentPageHref);
		if (navigation.to) navigation.to.url.href = committedUrl.href;
		if (!this.reachLoadCheckpoint(navigation)) throw new Error('navigation superseded');
		await Promise.all([...this.onNavigateCallbacks].map((callback) => callback(navigation)));
		if (!this.reachLoadCheckpoint(navigation)) {
			throw new Error('navigation superseded');
		}

		this.setPageUrl(committedHref);
		const activeElement = this.adapter.activeElement();
		await this.adapter.settled();
		await this.adapter.tick();
		await this.adapter.tick();
		this.flushRevision += 3;
		if (!this.reachLoadCheckpoint(navigation)) {
			throw new Error('navigation superseded');
		}
		const currentActiveElement = this.adapter.activeElement();
		const changedFocus =
			currentActiveElement !== activeElement && currentActiveElement !== this.adapter.bodyElement();
		if (!navigation.keepFocus && !changedFocus) {
			this.adapter.resetFocus(new URL(committedHref, this.currentPageHref));
		}

		this.activeNavigation = null;
		navigation.fulfil();
		for (const pending of this.#pendingNavigations) {
			if (pending.token === navigation.token) this.#pendingNavigations.delete(pending);
		}
		for (const callback of this.afterNavigateCallbacks) callback(navigation);
		this.adapter.publishNavigating(null);
		return navigation;
	}

	reset(): void {
		for (const navigation of this.#pendingNavigations) {
			navigation.reject(new Error('navigation aborted'));
		}
		this.#pendingNavigations.clear();
		this.activeNavigation = null;
		this.beforeNavigateCallbacks.clear();
		this.onNavigateCallbacks.clear();
		this.afterNavigateCallbacks.clear();
		this.acceptedPublications.length = 0;
		this.flushRevision = 0;
		this.adapter.publishNavigating(null);
	}
}
