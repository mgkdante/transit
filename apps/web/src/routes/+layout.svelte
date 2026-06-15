<!--
  Root layout — the app-shell backbone and the i18n / v1 context provider.

  This is the integration linchpin: every page renders inside the AppShell
  (TopBar + responsive 3-zone body) and reads the active locale + the v1 snapshot
  context that this layout provides ONCE here.

    fonts + app.css   side-effect imports (variable fonts BEFORE the stylesheet)
    themeStore.init() onMount — re-syncs the runes theme store with the pre-paint
                      <html data-theme> the app.html inline script applied
    locale context    setLocaleContext(() => lang) — a reader so late readers stay
                      reactive across EN⇄FR; lang is path-derived in +layout.ts
    v1 context        setV1Context(data.v1) — the booted snapshot context the whole
                      app reads via getV1Context(); booted fail-soft in +layout.ts
    children → main    the page tree renders into the shell's `main` zone; the
                      skip-link target #main lives on the wrapper inside it

  FAIL-SOFT: if +layout.ts could not boot the /v1 contract (manifest 404 /
  unreachable), `data.v1` is null. We then render the `error-v1` edge state in
  the shell `main` INSTEAD of the page tree — so no descendant ever calls
  getV1Context() without a provider — and offer a retry that re-runs the load.

  Adapted from the yesid.dev +layout.svelte chrome composition: gsap/lenis/seo/
  marketing stripped, re-themed to the transit shell. Tokens only.
-->
<script lang="ts">
	// Self-hosted variable fonts (side-effect imports) BEFORE app.css.
	import '@fontsource-variable/inter';
	import '@fontsource-variable/jetbrains-mono';
	import '../app.css';

	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';

	import { setLocaleContext, DEFAULT_LOCALE, type Locale } from '$lib/i18n';
	import { setV1Context, bootV1, type V1Context } from '$lib/v1';
	import { themeStore } from '$lib/stores';
	import { AppShell } from '$lib/components/shell';
	import { EdgeState } from '$lib/components/edge';
	import { layout } from '$lib/nav';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	// Active request locale (path-derived in +layout.ts). A reader is provided to
	// context so deep call sites that read it at init stay reactive across page
	// swaps (the root layout never remounts).
	const locale = $derived<Locale>(data.lang ?? DEFAULT_LOCALE);
	setLocaleContext(() => data.lang ?? DEFAULT_LOCALE);

	// v1 snapshot context. The SSR boot (+layout.ts) can fail on Cloudflare — a
	// Worker's fetch to its own zone can't reach the sibling /data route (523) —
	// so when it does we RE-BOOT client-side: the browser reaches /data fine.
	// `clientV1` holds that recovery; `v1` prefers the SSR value and falls back to
	// it. The context reader stays live, so once the client boot lands every
	// descendant that read getV1Context() at init sees the data without a remount.
	let clientV1 = $state<V1Context | null>(null);
	const v1 = $derived<V1Context | null>(data.v1 ?? clientV1);
	setV1Context(() => (v1 ?? undefined) as V1Context);

	// True while a client-side (re-)boot is in flight — lets the edge state show a
	// "retrying" affordance rather than a dead button.
	let rebooting = $state(false);

	async function clientBoot(): Promise<void> {
		if (!browser || rebooting) return;
		rebooting = true;
		try {
			clientV1 = await bootV1(data.lang ?? DEFAULT_LOCALE);
		} catch {
			// Still unreachable — keep the edge state up; the user can retry.
		} finally {
			rebooting = false;
		}
	}

	// Shell desktop/mobile split drives the edge-state skeleton/error density.
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	onMount(() => {
		// Re-sync the theme store with the pre-paint <html data-theme> attribute
		// and back-fill the theme-color meta (SSR'd dark).
		themeStore.init();
		// Recover a failed SSR boot — the browser can reach /data even when the SSR
		// worker could not. No-op when SSR already produced a context.
		if (data.v1Error && !data.v1) void clientBoot();
	});

	// Retry from the error edge state: re-boot client-side (a full reload would
	// just re-run the same failing SSR boot). Browser-only via clientBoot's guard.
	function retryBoot() {
		void clientBoot();
	}
</script>

<AppShell {locale} url={$page.url}>
	{#snippet main()}
		<!-- Skip-link target. The page tree (or the error edge state) renders here;
		     each shell zone scrolls internally, so this wrapper owns the scroll. -->
		<div id="main" class="h-full w-full overflow-y-auto" tabindex="-1">
			{#if !v1}
				<!-- /v1 contract unreachable: render the honest error state, never a
				     crash. Retry (and an automatic client re-boot on mount) re-fetch
				     the contract; the page tree renders the moment a context lands. -->
				<div class="mx-auto flex h-full max-w-2xl items-center justify-center p-6">
					<EdgeState
						variant="error-v1"
						lang={locale}
						layout={edgeLayout}
						onRetry={retryBoot}
						class="w-full"
					/>
				</div>
			{:else}
				{@render children?.()}
			{/if}
		</div>
	{/snippet}
</AppShell>
