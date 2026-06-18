<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import LocateFixedIcon from '@lucide/svelte/icons/locate-fixed';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Locale } from '$lib/i18n';
	import type { LatLon, WithDistance } from '$lib/components/map';
	import type { GeocodePrecision, GeocodeSuggestion } from '$lib/geocode/types';
	import type { StopIndexEntry } from '$lib/v1/schemas';
	import type { MapCopy } from './map.copy';

	interface Props {
		open?: boolean;
		query?: string;
		locale: Locale;
		copy: MapCopy;
		loading?: boolean;
		error?: string | null;
		origin?: (LatLon & { label: string; precision?: GeocodePrecision }) | null;
		stops?: readonly WithDistance<StopIndexEntry>[];
		onuselocation: () => void;
		onsearch: (event: SubmitEvent) => void | Promise<void>;
		onsuggestion: (result: GeocodeSuggestion) => void | Promise<void>;
		onstopselect: (stop: WithDistance<StopIndexEntry>) => void;
		onclear: () => void;
	}

	let {
		open = $bindable(false),
		query = $bindable(''),
		locale,
		copy: t,
		loading = false,
		error = null,
		origin = null,
		stops = [],
		onuselocation,
		onsearch,
		onsuggestion,
		onstopselect,
		onclear,
	}: Props = $props();

	let suggestions = $state<GeocodeSuggestion[]>([]);
	let suggestionsLoading = $state(false);
	let suggestionsOpen = $state(false);
	let suggestionSessionToken = $state(createSuggestionSessionToken());
	let lastSelectedSuggestionLabel = $state('');
	let rootEl = $state<HTMLElement>();
	let inputEl = $state<HTMLInputElement>();

	const suggestionListId = 'map-near-suggestions';
	const suggestionCache = new SvelteMap<string, GeocodeSuggestion[]>();
	const showSuggestions = $derived(
		open && suggestionsOpen && suggestions.length > 0 && shouldSuggestNearMeAddress(query),
	);
	const showGoogleAttribution = $derived(
		showSuggestions && suggestions.some((result) => result.attribution === 'google'),
	);

	function shouldSuggestNearMeAddress(value: string): boolean {
		const trimmed = value.trim();
		if (trimmed.length < 3) return false;
		return !isCoordinateQuery(trimmed);
	}

	function isCoordinateQuery(value: string): boolean {
		return /^\s*-?\d+(?:\.\d+)?\s*[, ]\s*-?\d*(?:\.\d*)?\s*$/.test(value);
	}

	function suggestionKey(result: GeocodeSuggestion): string {
		if (result.placeId) return `${result.source}:${result.placeId}`;
		return `${result.lat ?? 'pending'}:${result.lon ?? 'pending'}:${result.label}`;
	}

	function precisionLabel(precision: GeocodeSuggestion['precision']): string {
		if (precision === 'address') return locale === 'fr' ? 'Adresse' : 'Address';
		if (precision === 'street') return locale === 'fr' ? 'Rue' : 'Street';
		if (precision === 'neighbourhood') return locale === 'fr' ? 'Quartier' : 'Neighbourhood';
		if (precision === 'postal') return locale === 'fr' ? 'Code postal' : 'Postal code';
		return locale === 'fr' ? 'Lieu' : 'Place';
	}

	function selectSuggestion(result: GeocodeSuggestion): void {
		query = result.label;
		suggestions = [];
		suggestionsOpen = false;
		lastSelectedSuggestionLabel = result.label;
		suggestionSessionToken = createSuggestionSessionToken();
		inputEl?.blur();
		void onsuggestion(result);
	}

	function closeSuggestions(): void {
		suggestionsOpen = false;
	}

	function openSuggestions(): void {
		if (shouldSuggestNearMeAddress(query)) suggestionsOpen = true;
	}

	function handleInput(): void {
		lastSelectedSuggestionLabel = '';
		suggestionsOpen = true;
	}

	function handleWindowPointerDown(event: PointerEvent): void {
		if (!rootEl || !(event.target instanceof Node)) return;
		if (!rootEl.contains(event.target)) closeSuggestions();
	}

	function handleWindowKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') closeSuggestions();
	}

	function formatDistance(distanceM: number): string {
		if (distanceM < 1_000) return `${Math.round(distanceM)} m`;
		return `${(distanceM / 1_000).toFixed(1)} km`;
	}

	$effect(() => {
		const trimmed = query.trim();
		if (!open || !suggestionsOpen || !shouldSuggestNearMeAddress(trimmed)) {
			suggestions = [];
			suggestionsLoading = false;
			return;
		}

		if (trimmed === lastSelectedSuggestionLabel) {
			suggestions = [];
			suggestionsLoading = false;
			return;
		}

		const cacheKey = trimmed.toLocaleLowerCase('en-CA');
		const cached = suggestionCache.get(cacheKey);
		if (cached) {
			suggestions = cached;
			suggestionsLoading = false;
			return;
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => {
			suggestionsLoading = true;
			const url = `/api/geocode/montreal?q=${encodeURIComponent(trimmed)}&suggest=1&limit=4&session=${encodeURIComponent(suggestionSessionToken)}`;
			void fetch(url, { signal: controller.signal })
				.then(async (response) => {
					if (!response.ok) return [];
					const payload = (await response.json()) as { results?: GeocodeSuggestion[] };
					return payload.results ?? [];
				})
				.then((results) => {
					if (!controller.signal.aborted) {
						suggestionCache.set(cacheKey, results);
						suggestions = results;
					}
				})
				.catch((err: unknown) => {
					if (err instanceof DOMException && err.name === 'AbortError') return;
					if (!controller.signal.aborted) suggestions = [];
				})
				.finally(() => {
					if (!controller.signal.aborted) suggestionsLoading = false;
				});
		}, 120);

		return () => {
			clearTimeout(timeout);
			controller.abort();
		};
	});

	function createSuggestionSessionToken(): string {
		return globalThis.crypto?.randomUUID?.() ?? `near-${Date.now()}-${Math.random()}`;
	}
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeydown} />

<div class="map-near" bind:this={rootEl}>
	<button
		type="button"
		class="map-near-toggle"
		aria-expanded={open}
		aria-label={t.nearMe}
		onclick={() => (open = !open)}
	>
		<LocateFixedIcon class="map-near-icon" size={18} strokeWidth={2.25} aria-hidden="true" />
		<span>{t.nearMe}</span>
	</button>
	{#if open}
		<div class="map-near-panel">
			<button type="button" class="map-near-action" onclick={onuselocation}>
				{t.nearMeUseLocation}
			</button>
			<form class="map-near-form" onsubmit={onsearch}>
				<div class="map-near-input-wrap">
					<input
						bind:this={inputEl}
						type="search"
						bind:value={query}
						placeholder={t.nearMeSearchPlaceholder}
						aria-label={t.nearMeSearchPlaceholder}
						aria-autocomplete="list"
						aria-controls={suggestionListId}
						aria-expanded={showSuggestions}
						autocomplete="street-address"
						role="combobox"
						spellcheck="false"
						onfocus={openSuggestions}
						oninput={handleInput}
					/>
				</div>
				<button type="submit" aria-busy={suggestionsLoading}>{t.nearMeSearchSubmit}</button>
				{#if showSuggestions}
					<div class="map-near-suggestions" id={suggestionListId} role="listbox">
						{#each suggestions as result (suggestionKey(result))}
							<button
								type="button"
								class="map-near-suggestion"
								role="option"
								aria-selected="false"
								onclick={() => selectSuggestion(result)}
							>
								<span>{result.label}</span>
								<small>{precisionLabel(result.precision)}</small>
							</button>
						{/each}
						{#if showGoogleAttribution}
							<div class="map-near-google-attribution" aria-label="Powered by Google">
								<span>Powered by</span>
								<span class="map-near-google-wordmark" aria-hidden="true">
									<span>G</span><span>o</span><span>o</span><span>g</span><span>l</span><span
										>e</span
									>
								</span>
							</div>
						{/if}
					</div>
				{/if}
			</form>
			{#if loading}
				<p class="map-near-message">{t.nearMeLoading}</p>
			{:else if error}
				<p class="map-near-message" data-error="true">{error}</p>
			{:else if origin}
				<div class="map-near-origin-row">
					<p class="map-near-origin">{origin.label}</p>
					<button type="button" class="map-near-clear" onclick={onclear}>
						<XIcon size={13} strokeWidth={2.25} aria-hidden="true" />
						<span>{t.nearMeClear}</span>
					</button>
				</div>
				{#if stops.length > 0}
					<div class="map-near-results">
						{#each stops as stop (stop.id)}
							<button type="button" class="map-near-stop" onclick={() => onstopselect(stop)}>
								<span>{stop.name}</span>
								<small>{formatDistance(stop.distanceM)}</small>
							</button>
						{/each}
					</div>
				{:else}
					<p class="map-near-message">{t.nearMeNoResults}</p>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.map-near {
		position: absolute;
		z-index: 10;
		top: auto;
		right: calc(var(--map-detail-offset, 0rem) + 1rem);
		bottom: 5.1rem;
		left: auto;
		transform: none;
		display: grid;
		gap: 0.45rem;
		width: auto;
		justify-items: end;
		transition: right 180ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
	}
	.map-near-toggle,
	.map-near-action,
	.map-near-form button,
	.map-near-stop,
	.map-near-suggestion,
	.map-near-clear {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		border: 1px solid var(--border-subtle);
		cursor: pointer;
	}
	.map-near-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		justify-self: end;
		min-height: 2rem;
		padding: 0.35rem 0.7rem;
		color: var(--foreground);
		background: color-mix(in srgb, var(--card) 90%, transparent);
		border-color: color-mix(in srgb, var(--border) 82%, var(--primary) 18%);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(8px);
	}
	.map-near-toggle:hover,
	.map-near-toggle:focus-visible,
	.map-near-action:hover,
	.map-near-action:focus-visible,
	.map-near-form button:hover,
	.map-near-form button:focus-visible,
	.map-near-stop:hover,
	.map-near-stop:focus-visible,
	.map-near-suggestion:hover,
	.map-near-suggestion:focus-visible,
	.map-near-clear:hover,
	.map-near-clear:focus-visible {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 10%, var(--muted) 90%);
		border-color: color-mix(in srgb, var(--primary) 42%, var(--border) 58%);
		outline: none;
	}
	:global(.map-near-icon) {
		flex: none;
		color: var(--primary);
	}
	.map-near-panel {
		position: absolute;
		right: 0;
		bottom: calc(100% + 0.5rem);
		width: min(28rem, calc(100vw - var(--map-detail-offset, 0rem) - 2rem));
		display: grid;
		gap: 0.45rem;
		padding: 0.55rem;
		background: color-mix(in srgb, var(--card) 94%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 78%, var(--primary) 22%);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(10px);
	}
	.map-near-action,
	.map-near-form button {
		min-height: 2rem;
		padding: 0.3rem 0.65rem;
		color: var(--foreground);
		background: var(--muted);
		border-radius: var(--radius-pill);
	}
	.map-near-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.35rem;
	}
	.map-near-input-wrap {
		position: relative;
		min-width: 0;
	}
	.map-near-form input {
		width: 100%;
		min-width: 0;
		min-height: 2rem;
		padding: 0.3rem 0.6rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--foreground);
		background: var(--muted);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-pill);
	}
	.map-near-form input::placeholder,
	.map-near-message,
	.map-near-origin,
	.map-near-stop small,
	.map-near-suggestion small {
		color: var(--muted-foreground);
	}
	.map-near-form input:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	.map-near-suggestions {
		grid-column: 1 / -1;
		z-index: 2;
		display: grid;
		gap: 0.25rem;
		max-height: min(18rem, calc(100vh - 10rem));
		overflow-y: auto;
		padding: 0.3rem;
		background: color-mix(in srgb, var(--card) 98%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 78%, var(--primary) 22%);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
	}
	.map-near-suggestion {
		display: grid;
		gap: 0.1rem;
		min-height: 2rem;
		padding: 0.35rem 0.55rem;
		color: var(--foreground);
		text-align: left;
		background: var(--muted);
		border-radius: var(--radius-sm);
	}
	.map-near-suggestion span {
		min-width: 0;
		overflow: visible;
		text-overflow: clip;
		white-space: normal;
	}
	.map-near-stop span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.map-near-suggestion small {
		font-size: var(--text-micro);
	}
	.map-near-google-attribution {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.3rem;
		min-height: 1.5rem;
		padding: 0.25rem 0.4rem 0.1rem;
		color: var(--muted-foreground);
		background: color-mix(in srgb, var(--card) 92%, transparent);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}
	.map-near-google-wordmark {
		display: inline-flex;
		align-items: baseline;
		font-family: var(--font-heading);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0;
	}
	.map-near-google-wordmark span:nth-child(1),
	.map-near-google-wordmark span:nth-child(4) {
		color: #4285f4;
	}
	.map-near-google-wordmark span:nth-child(2),
	.map-near-google-wordmark span:nth-child(6) {
		color: #ea4335;
	}
	.map-near-google-wordmark span:nth-child(3) {
		color: #fbbc05;
	}
	.map-near-google-wordmark span:nth-child(5) {
		color: #34a853;
	}
	.map-near-message,
	.map-near-origin {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}
	.map-near-message[data-error='true'] {
		color: var(--dataviz-severity-high);
	}
	.map-near-origin-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.45rem;
	}
	.map-near-origin {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.map-near-clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		min-height: 1.75rem;
		padding: 0.25rem 0.5rem;
		color: var(--muted-foreground);
		background: var(--muted);
		border-radius: var(--radius-pill);
	}
	.map-near-results {
		display: grid;
		gap: 0.3rem;
	}
	.map-near-stop {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		min-height: 2rem;
		padding: 0.3rem 0.6rem;
		color: var(--foreground);
		text-align: left;
		background: var(--muted);
		border-radius: var(--radius-sm);
	}
	.map-near-stop small {
		flex: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.map-near {
			transition: none;
		}
	}

	@media (max-width: 760px) {
		.map-near {
			top: auto;
			right: 0.75rem;
			bottom: calc(3.35rem + env(safe-area-inset-bottom, 0px));
			left: auto;
			width: auto;
			transform: none;
		}
		.map-near-toggle {
			justify-self: end;
			width: 2.75rem;
			height: 2.75rem;
			min-height: 2.75rem;
			padding: 0;
			border-radius: 999px;
		}
		.map-near-toggle span {
			display: none;
		}
		.map-near-panel {
			width: min(24rem, calc(100vw - 1.5rem));
			max-width: calc(100vw - 1.5rem);
		}
	}
</style>
