<script module lang="ts">
	import type { Component } from 'svelte';

	export interface ProgressiveMapFailure {
		readonly kind: string;
		readonly retry: () => Promise<void>;
	}

	export interface ProgressiveMapHeroProps {
		onready?: () => void;
		onidle?: () => void;
		onfailure?: (failure: ProgressiveMapFailure | null) => void;
	}

	export type ProgressiveMapHeroModule = {
		default: Component<ProgressiveMapHeroProps>;
	};
</script>

<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { getLocale } from '$lib/i18n';
	import { themeStore } from '$lib/stores';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import { copy as MAP_COPY } from './map.copy';

	interface Props {
		importHero?: () => Promise<ProgressiveMapHeroModule>;
	}

	let { importHero }: Props = $props();

	type ProgressiveState = 'static' | 'booting' | 'ready' | 'failed';
	const locale = getLocale();
	const t = $derived(MAP_COPY[locale]);
	const posterTheme = $derived(themeStore.current);
	const posterMobile = $derived(`/map/basemap-montreal-${posterTheme}-mobile-20260812.avif`);
	const posterDesktop = $derived(`/map/basemap-montreal-${posterTheme}-desktop-20260812.avif`);

	let root = $state<HTMLDivElement | null>(null);
	let liveLayer = $state<HTMLDivElement | null>(null);
	let phase = $state<ProgressiveState>('static');
	let LiveMap = $state.raw<ProgressiveMapHeroModule['default'] | null>(null);
	let importPending: Promise<void> | null = null;
	let liveFailure: ProgressiveMapFailure | null = null;
	let liveRetryPending = $state(false);
	let attempt = $state(0);
	let intentTime = $state<number | null>(null);
	let readyTime = $state<number | null>(null);
	let idleTime = $state<number | null>(null);
	let idleAttempt = 0;
	let focusLiveOnIdle = false;
	let alive = true;

	onDestroy(() => {
		alive = false;
	});

	function clock(): number {
		return typeof performance === 'undefined' ? 0 : performance.now();
	}

	function publish(type: string, time: number): void {
		root?.dispatchEvent(
			new CustomEvent(type, {
				bubbles: true,
				detail: { attempt, time },
			}),
		);
	}

	function acknowledgeIntent(): void {
		attempt += 1;
		intentTime = clock();
		readyTime = null;
		idleTime = null;
		idleAttempt = 0;
		phase = 'booting';
		publish('transit:map-intent', intentTime);
	}

	async function waitForBootPresentation(activeAttempt: number): Promise<boolean> {
		await tick();
		if (!alive || attempt !== activeAttempt || phase !== 'booting') return false;
		if (typeof requestAnimationFrame === 'function') {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			);
		}
		return alive && attempt === activeAttempt && phase === 'booting';
	}

	function activate(event?: MouseEvent): void {
		if (importPending || LiveMap || phase === 'booting') return;
		focusLiveOnIdle = event?.detail === 0;
		acknowledgeIntent();
		liveFailure = null;
		const activeAttempt = attempt;
		const pending = waitForBootPresentation(activeAttempt)
			.then((mayStart) => {
				if (!mayStart) return null;
				return importHero ? importHero() : import('./MapHero.svelte');
			})
			.then((module) => {
				if (!module || !alive || attempt !== activeAttempt) return;
				LiveMap = module.default;
			})
			.catch(() => {
				if (!alive || attempt !== activeAttempt) return;
				phase = 'failed';
			})
			.finally(() => {
				if (importPending === pending) importPending = null;
			});
		importPending = pending;
	}

	function handleReady(): void {
		if (phase !== 'booting' || readyTime !== null) return;
		readyTime = clock();
		publish('transit:map-ready', readyTime);
	}

	function handleIdle(): void {
		if (idleAttempt === attempt || phase !== 'booting' || readyTime === null) return;
		const shouldMoveFocus = focusLiveOnIdle;
		focusLiveOnIdle = false;
		idleAttempt = attempt;
		idleTime = clock();
		phase = 'ready';
		publish('transit:maplibre-idle', idleTime);
		if (shouldMoveFocus) {
			void tick().then(() => {
				if (!alive || phase !== 'ready') return;
				liveLayer?.querySelector<HTMLElement>('.maplibregl-canvas')?.focus({ preventScroll: true });
			});
		}
	}

	function handleFailure(failure: ProgressiveMapFailure | null): void {
		liveFailure = failure;
		if (failure) phase = 'failed';
		else if (LiveMap) phase = 'booting';
	}

	function retry(event?: MouseEvent): void {
		if (phase !== 'failed' || liveRetryPending) return;
		if (!liveFailure) {
			LiveMap = null;
			activate(event);
			return;
		}

		const retryFailure = liveFailure;
		focusLiveOnIdle = event?.detail === 0;
		liveRetryPending = true;
		acknowledgeIntent();
		const activeAttempt = attempt;
		void waitForBootPresentation(activeAttempt)
			.then((mayStart) => {
				if (!mayStart) return;
				return retryFailure.retry();
			})
			.catch(() => {
				if (alive && attempt === activeAttempt) phase = 'failed';
			})
			.finally(() => {
				liveRetryPending = false;
			});
	}
</script>

<div
	class="map-progressive"
	data-testid="map-progressive"
	data-map-progressive-state={phase}
	data-map-attempt={attempt}
	data-map-intent-time={intentTime ?? undefined}
	data-map-ready-time={readyTime ?? undefined}
	data-map-idle-time={idleTime ?? undefined}
	bind:this={root}
>
	<div
		bind:this={liveLayer}
		class="map-progressive-live"
		data-testid="map-progressive-live"
		data-visible={phase === 'ready'}
		aria-hidden={phase === 'ready' ? undefined : 'true'}
		inert={phase === 'ready' ? undefined : true}
		style:transition={$prefersReducedMotion ? 'none' : undefined}
	>
		{#if LiveMap}
			<LiveMap onready={handleReady} onidle={handleIdle} onfailure={handleFailure} />
		{/if}
	</div>

	<section
		class="map-progressive-poster"
		data-slot="map-static"
		data-testid="map-progressive-poster"
		data-visible={phase !== 'ready'}
		aria-hidden={phase === 'ready' ? 'true' : undefined}
		inert={phase === 'ready' ? true : undefined}
		aria-labelledby="map-progressive-heading"
		style:transition={$prefersReducedMotion ? 'none' : undefined}
	>
		<picture class="map-progressive-picture">
			<source
				media="(min-width: 1024px)"
				type="image/avif"
				srcset={posterDesktop}
				width="1280"
				height="720"
			/>
			<img
				src={posterMobile}
				width="390"
				height="844"
				alt={t.staticImageAlt}
				fetchpriority="high"
				decoding="async"
			/>
		</picture>
		<div class="map-progressive-shade" aria-hidden="true"></div>

		<div class="map-progressive-copy">
			<p class="map-progressive-kicker">{t.staticKicker}</p>
			<h1 id="map-progressive-heading">{t.staticHeading}</h1>
			<p class="map-progressive-body">{t.staticBody}</p>
			<p class="map-progressive-snapshot">{t.staticSnapshot}</p>

			{#if phase === 'static' || phase === 'booting'}
				<button
					type="button"
					class="map-progressive-action"
					data-map-wake
					aria-disabled={phase === 'booting' ? 'true' : undefined}
					onclick={activate}
				>
					{t.activateMap}
				</button>
				{#if phase === 'booting'}
					<p class="map-progressive-status" role="status" aria-live="polite">{t.mapBooting}</p>
				{/if}
			{:else if phase === 'failed'}
				<div class="map-progressive-failure" role="alert">
					<p>{t.mapImportError}</p>
					<button
						type="button"
						class="map-progressive-action"
						data-map-wake
						disabled={liveRetryPending}
						onclick={retry}>{t.mapImportRetry}</button
					>
				</div>
			{/if}
		</div>

		<p class="map-progressive-attribution">
			<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>
			<span aria-hidden="true"> · </span>
			<a href="https://github.com/protomaps/basemaps">© Protomaps</a>
		</p>

		<noscript><p class="map-progressive-noscript">{t.staticNoScript}</p></noscript>
	</section>
</div>

<style>
	.map-progressive {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
		overflow: hidden;
		background: var(--background);
	}

	.map-progressive-live,
	.map-progressive-poster {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		transition: opacity var(--duration-normal) var(--ease-out);
	}

	.map-progressive-live {
		z-index: 1;
		opacity: 0;
	}

	.map-progressive-live[data-visible='true'] {
		z-index: 3;
		opacity: 1;
	}

	.map-progressive-poster {
		z-index: 2;
		margin: 0;
		overflow: hidden;
		opacity: 1;
		color: var(--reflective);
		background: var(--background);
	}

	.map-progressive-poster[data-visible='false'] {
		opacity: 0;
		pointer-events: none;
	}

	.map-progressive-picture,
	.map-progressive-picture img {
		display: block;
		width: 100%;
		height: 100%;
	}

	.map-progressive-picture img {
		object-fit: cover;
	}

	.map-progressive-shade {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--hazard-b) 10%, transparent) 30%,
				color-mix(in srgb, var(--hazard-b) 88%, transparent) 100%
			),
			linear-gradient(
				90deg,
				color-mix(in srgb, var(--hazard-b) 58%, transparent) 0%,
				transparent 68%
			);
	}

	.map-progressive-copy {
		position: absolute;
		z-index: 1;
		left: clamp(1rem, 4vw, 3.5rem);
		bottom: clamp(4.5rem, 10vh, 7rem);
		width: min(34rem, calc(100% - 2rem));
	}

	.map-progressive-kicker {
		margin: 0 0 0.45rem;
		font: 700 0.72rem/1.2 var(--font-mono);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-size: var(--text-display);
		font-weight: 700;
		line-height: 0.98;
		letter-spacing: var(--tracking-tight);
	}

	.map-progressive-body {
		max-width: var(--measure-body);
		margin: 0.8rem 0 0;
		font-size: clamp(0.92rem, 1.6vw, 1.05rem);
		line-height: 1.5;
		text-wrap: balance;
	}

	.map-progressive-snapshot {
		margin: 0.45rem 0 0;
		font: 600 0.72rem/1.3 var(--font-mono);
		letter-spacing: 0.04em;
		color: color-mix(in srgb, var(--reflective) 82%, transparent);
	}

	.map-progressive-action {
		min-height: 2.75rem;
		margin-top: 1rem;
		padding: 0.65rem 1rem;
		border: 1px solid color-mix(in srgb, var(--reflective) 68%, transparent);
		border-radius: var(--radius-md);
		background: var(--primary);
		color: var(--primary-foreground);
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.map-progressive-action:focus-visible {
		outline: 3px solid var(--ring);
		outline-offset: 3px;
	}

	.map-progressive-action:disabled {
		cursor: wait;
		opacity: 0.72;
	}

	.map-progressive-status,
	.map-progressive-failure {
		margin: 1rem 0 0;
		font-weight: 700;
	}

	.map-progressive-failure p {
		margin: 0;
	}

	.map-progressive-attribution,
	.map-progressive-noscript {
		position: absolute;
		z-index: 1;
		right: 0.65rem;
		bottom: 0.55rem;
		margin: 0;
		padding: 0.28rem 0.42rem;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--hazard-b) 78%, transparent);
		font-size: 0.68rem;
		line-height: 1.35;
	}

	.map-progressive-attribution a {
		color: var(--reflective);
		text-decoration: underline;
		text-underline-offset: 0.14em;
	}

	.map-progressive-noscript {
		left: 0.65rem;
		right: auto;
		bottom: 0.55rem;
		max-width: min(var(--measure-lede), calc(100% - 1.3rem));
	}

	@media (prefers-reduced-motion: reduce) {
		.map-progressive-live,
		.map-progressive-poster {
			transition: none;
		}
	}

	@media (max-width: 767px) {
		.map-progressive-copy {
			bottom: 5rem;
		}

		.map-progressive-attribution {
			left: 0.65rem;
			right: auto;
			max-width: calc(100% - 1.3rem);
		}

		.map-progressive-noscript {
			bottom: 2.25rem;
		}
	}
</style>
