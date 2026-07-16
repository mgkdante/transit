/**
 * Shared GSAP ticker fan-out, reconciled from the transit and yesid.dev forks.
 *
 * Both apps had the same runtime implementation, so the canonical version
 * preserves their common contract: one persistent GSAP subscription, string
 * IDs that replace duplicate subscribers, and both explicit and disposer-based
 * unsubscribe paths. The package tests combine yesid.dev's many-subscriber
 * coverage with transit's stricter GSAP callback typing and reset assertion.
 *
 * The internal GSAP callback intentionally remains registered when the last
 * app subscriber leaves, matching both consumers and avoiding add/remove churn.
 * `_resetForTests()` is the explicit teardown for isolated test modules.
 */

import { gsap } from 'gsap';

export type TickerCallback = (time: number, deltaTime: number) => void;

const subscribers = new Map<string, TickerCallback>();
let internalSubscription: TickerCallback | null = null;

function ensureTickerSubscription(): void {
	if (internalSubscription) return;
	internalSubscription = (time: number, deltaTime: number) => {
		subscribers.forEach((callback) => callback(time, deltaTime));
	};
	gsap.ticker.add(internalSubscription);
}

/**
 * Subscribe a callback to every frame tick.
 *
 * @param id Unique identifier. Reusing an ID replaces its previous callback.
 * @param callback Receives elapsed `time` in seconds and `deltaTime` in
 * milliseconds, matching the first two arguments of `gsap.ticker.add`.
 * @returns A disposer that unsubscribes the ID.
 */
export function subscribe(id: string, callback: TickerCallback): () => void {
	ensureTickerSubscription();
	subscribers.set(id, callback);
	return () => unsubscribe(id);
}

/** Remove a subscribed callback by ID. Unknown IDs are a no-op. */
export function unsubscribe(id: string): void {
	subscribers.delete(id);
}

/**
 * Remove the shared GSAP callback and clear subscribers for test isolation.
 *
 * @internal
 */
export function _resetForTests(): void {
	if (internalSubscription) {
		gsap.ticker.remove(internalSubscription);
		internalSubscription = null;
	}
	subscribers.clear();
}
