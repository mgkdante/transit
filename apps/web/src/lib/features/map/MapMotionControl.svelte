<script lang="ts">
	import WavesIcon from '@lucide/svelte/icons/waves';
	import { motionMode } from '$lib/stores';
	import { localizeHref, type Locale } from '$lib/i18n';
	import type { MapCopy } from './map.copy';

	interface Props {
		locale: Locale;
		copy: MapCopy;
		collapsed?: boolean;
	}

	let { locale, copy: t, collapsed = false }: Props = $props();

	const smooth = $derived(motionMode.isSmooth);
	const explainHref = $derived(`${localizeHref('/metrics', locale)}#live-positions`);
</script>

<div class="map-motion" data-testid="map-motion" data-collapsed={collapsed}>
	{#if collapsed}
		<span class="map-motion-badge" aria-hidden="true">
			<WavesIcon size={13} strokeWidth={2.35} />
		</span>
		<button
			type="button"
			class="map-motion-round"
			role="switch"
			aria-checked={smooth}
			aria-label={t.motion.toSmooth}
			data-testid="map-motion-switch"
			onclick={() => motionMode.toggle()}
		></button>
	{:else}
		<div class="map-motion-heading">
			<span class="map-motion-label">{t.motion.label}</span>
			<button
				type="button"
				class="map-motion-switch"
				role="switch"
				aria-checked={smooth}
				aria-label={t.motion.toSmooth}
				data-testid="map-motion-switch"
				onclick={() => motionMode.toggle()}
			>
				<span class="map-motion-track" aria-hidden="true"
					><span class="map-motion-thumb"></span></span
				>
				<span class="map-motion-state">{smooth ? t.motion.smooth : t.motion.raw}</span>
			</button>
		</div>
		<div class="map-motion-caption">
			<span class="map-motion-hint">{smooth ? t.motion.hintSmooth : t.motion.hintRaw}</span>
			<a class="map-motion-explain" href={explainHref}>{t.motion.explain}</a>
		</div>
	{/if}
</div>

<style>
	.map-motion {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.375rem;
		width: 100%;
		min-width: 0;
		max-height: 160px;
		justify-self: start;
	}
	.map-motion-heading,
	.map-motion-caption {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}
	.map-motion-caption {
		align-items: center;
	}
	.map-motion[data-collapsed='true'] {
		gap: 0.375rem;
		justify-items: center;
	}
	.map-motion-label {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.map-motion-badge {
		display: inline-grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		flex: none;
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 32%, transparent);
		border-radius: var(--radius-sm);
	}
	.map-motion-badge :global(svg) {
		width: 0.82rem;
		height: 0.82rem;
	}
	.map-motion-switch {
		display: inline-flex;
		justify-self: start;
		align-items: center;
		gap: 0.375rem;
		min-height: 44px;
		padding: 0.25rem 0.5rem 0.25rem 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--foreground);
		background: var(--muted);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-pill);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	.map-motion-switch:hover,
	.map-motion-switch:focus-visible {
		border-color: color-mix(in srgb, var(--primary) 42%, var(--border) 58%);
	}
	.map-motion-switch[aria-checked='true'] {
		color: var(--primary);
		border-color: color-mix(in srgb, var(--primary) 50%, var(--border) 50%);
		background: color-mix(in srgb, var(--primary) 10%, var(--muted) 90%);
	}
	.map-motion-track {
		position: relative;
		flex: none;
		width: 1.85rem;
		height: 1.05rem;
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--border) 70%, transparent);
		transition: background-color var(--duration-fast) var(--ease-default);
	}
	.map-motion-switch[aria-checked='true'] .map-motion-track {
		background: color-mix(in srgb, var(--primary) 55%, transparent);
	}
	.map-motion-thumb {
		position: absolute;
		top: 50%;
		left: 0.125rem;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--card);
		box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 30%, transparent);
		transform: translate(0, -50%);
		transition: transform var(--duration-fast) var(--ease-out);
	}
	.map-motion-switch[aria-checked='true'] .map-motion-thumb {
		transform: translate(0.8rem, -50%);
	}
	.map-motion-state {
		white-space: nowrap;
	}
	.map-motion-hint {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.map-motion-explain {
		display: inline-flex;
		min-width: 44px;
		flex: none;
		justify-content: center;
		align-items: center;
		justify-self: start;
		min-height: 44px;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--primary);
		text-decoration: none;
		transition: opacity var(--duration-fast) var(--ease-default);
	}
	.map-motion-explain:hover,
	.map-motion-explain:focus-visible {
		text-decoration: underline;
	}
	.map-motion-explain:focus-visible {
		border-radius: var(--radius-sm);
	}

	.map-motion-round {
		display: inline-grid;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		background: transparent;
		border: 1px solid var(--border-subtle);
		border-radius: 50%;
		color: var(--muted-foreground);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	.map-motion-round:hover,
	.map-motion-round:focus-visible {
		border-color: color-mix(in srgb, var(--primary) 48%, var(--border) 52%);
	}
	.map-motion-round[aria-checked='true'] {
		color: var(--primary-foreground);
		background: var(--primary);
		border-color: var(--primary);
	}

	@media (prefers-reduced-motion: reduce) {
		.map-motion-track,
		.map-motion-thumb,
		.map-motion-switch,
		.map-motion-round,
		.map-motion-explain {
			transition: none;
		}
	}
</style>
