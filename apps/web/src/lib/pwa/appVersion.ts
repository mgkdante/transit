// appVersion — PURE decision logic for picking up a fresh deploy in a long-lived
// client session (the SPA / installed-PWA freshness lever).
//
// CONTEXT
//   The service worker (service-worker.ts) already keeps FULL navigations fresh:
//   they are network-first, so any cold load / hard reload fetches the live
//   document and the newest hashed assets, and the version-stamped cache name
//   (cacheNameFor) drops stale shells on activate. But a LONG-LIVED session — a
//   tab left open, or a standalone PWA the OS resumes — drives SvelteKit's
//   CLIENT-SIDE router, which swaps route chunks WITHOUT a document load. After a
//   deploy those `/_app/immutable/*` chunks can be gone, and with no app-version
//   awareness the session keeps running stale code until something 404s.
//
//   SvelteKit closes this gap when `kit.version.pollInterval` is set (see
//   svelte.config.js): it polls `/_app/version.json` and flips `updated.current`
//   to `true` once it detects a new build. This module turns that signal into the
//   single action that upgrades the session with AT MOST ONE reload — on the next
//   in-app navigation, do a full-page load of the target URL instead of a
//   client-side swap. In steady state (no pending deploy) it is a no-op, so there
//   is no behavior change beyond freshness.
//
// Kept pure (no `window`/`location`/SvelteKit imports) so the decision is
// unit-testable without a browser, mirroring swPolicy.ts / register.ts.

/**
 * Poll cadence (ms) for `/_app/version.json`. This is the source of truth for the
 * value mirrored into `kit.version.pollInterval` in svelte.config.js; a test
 * asserts the two agree so the freshness contract cannot silently drift. 60s is a
 * negligible request (a few bytes) next to the app's existing 30s data refresh.
 */
export const VERSION_POLL_INTERVAL_MS = 60_000;

export interface FreshnessReloadDecision {
	/** Whether to replace the imminent SPA navigation with a full-page load. */
	readonly reload: boolean;
	/** The URL to hard-load when `reload` is true; otherwise null. */
	readonly href: string | null;
}

const NO_RELOAD: FreshnessReloadDecision = { reload: false, href: null };

/**
 * Decide whether an imminent navigation should be upgraded to a full-page reload
 * so the visitor lands on the freshly-deployed build.
 *
 * Reload ONLY when ALL of these hold:
 *   - a newer deploy was detected — `hasNewVersion` (SvelteKit's `updated.current`);
 *   - the navigation stays in the app — `toHref` is a real target (a leave-the-app
 *     navigation has no in-app target, so there is nothing for us to reload into);
 *   - the browser is not already doing a full load — `willUnload` is false
 *     (external links / `location.href` assignments already reload the document,
 *     so we must not double up).
 *
 * @param input.hasNewVersion whether a new build is live (`updated.current`).
 * @param input.willUnload    SvelteKit `Navigation.willUnload` for this navigation.
 * @param input.toHref        the absolute href of the navigation target, or null.
 */
export function decideFreshnessReload(input: {
	hasNewVersion: boolean;
	willUnload: boolean;
	toHref: string | null | undefined;
}): FreshnessReloadDecision {
	if (!input.hasNewVersion) return NO_RELOAD;
	if (input.willUnload) return NO_RELOAD;
	if (!input.toHref) return NO_RELOAD;
	return { reload: true, href: input.toHref };
}
