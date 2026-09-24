// EdgeState.test.ts — the 6-variant edge-condition primitive, the DOM gate.
//
// Gates:
//   - ALL 6 VARIANTS RENDER in BOTH locales (FR + EN): skeleton + the five
//     message variants (stale-offline, no-results, empty, empty-avis, error-v1).
//     Each carries its data-variant attribute and (for message variants) its
//     localized title.
//   - a11y verdict surface: message variants expose a live region (role=status,
//     escalating to role=alert for error-v1); the skeleton announces aria-busy.
//   - DOCTRINE: the verdict glyph is aria-hidden (colour + glyph + text, never
//     colour alone — the visible text carries the meaning for AT).
//   - error-v1 shows the RETRY button only when an onRetry handler is supplied,
//     and clicking it fires the handler.

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import EdgeState from './EdgeState.svelte';
import { DEFAULT_LOADING_SKELETON_DELAY_MS } from './loading';
import type { Locale } from '$lib/i18n';
import { sharedClock } from '$lib/stores/clock.svelte';

vi.mock('$app/environment', () => ({ browser: true }));

const LOCALES: Locale[] = ['en', 'fr'];

// Localized titles per variant (mirrors the component's COPY object) — proves
// the right language slotted in, not just that *something* rendered.
const TITLES = {
	'stale-offline': { en: 'Data is behind', fr: 'Données en retard' },
	'no-results': { en: 'No results', fr: 'Aucun résultat' },
	empty: { en: 'Nothing to show', fr: 'Rien à afficher' },
	'empty-avis': { en: 'No alerts', fr: 'Aucun avis' },
	'error-v1': { en: 'Data unavailable', fr: 'Données indisponibles' },
} satisfies Record<string, Record<Locale, string>>;

const MESSAGE_VARIANTS = Object.keys(TITLES) as Array<keyof typeof TITLES>;

describe('EdgeState — all 6 variants render in FR + EN', () => {
	for (const lang of LOCALES) {
		it(`skeleton renders a busy loading region (${lang})`, () => {
			const { container } = render(EdgeState, {
				props: { variant: 'skeleton', lang, skeletonDelayMs: 0 },
			});
			const root = container.querySelector('[data-slot="edge-state"]');
			expect(root).not.toBeNull();
			expect(root).toHaveAttribute('data-variant', 'skeleton');
			expect(root).toHaveAttribute('aria-busy', 'true');
			// Loading label is announced to AT (sr-only), localized.
			expect(root!.textContent).toContain(lang === 'fr' ? 'Chargement' : 'Loading');
		});

		for (const variant of MESSAGE_VARIANTS) {
			it(`${variant} renders with its localized title (${lang})`, () => {
				const { container, getByText } = render(EdgeState, { props: { variant, lang } });
				const root = container.querySelector('[data-slot="edge-state"]');
				expect(root).toHaveAttribute('data-variant', variant);
				expect(getByText(TITLES[variant][lang])).toBeInTheDocument();
			});
		}
	}
});

describe('EdgeState — delayed skeleton fallback', () => {
	it('keeps the skeleton inert through the shared grace period, then announces a slow load', async () => {
		vi.useFakeTimers();

		try {
			const { container } = render(EdgeState, {
				props: { variant: 'skeleton', lang: 'en' },
			});
			const root = container.querySelector('[data-slot="edge-state"]');

			expect(root).toHaveAttribute('data-loading-state', 'pending');
			expect(root).toHaveAttribute('aria-hidden', 'true');
			expect(root).not.toHaveAttribute('aria-busy');

			await vi.advanceTimersByTimeAsync(DEFAULT_LOADING_SKELETON_DELAY_MS - 1);
			expect(root).toHaveAttribute('data-loading-state', 'pending');

			await vi.advanceTimersByTimeAsync(1);
			expect(root).toHaveAttribute('data-loading-state', 'visible');
			expect(root).not.toHaveAttribute('aria-hidden');
			expect(root).toHaveAttribute('aria-busy', 'true');
			expect(root).toHaveAttribute('role', 'status');
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('EdgeState — a11y verdict surface', () => {
	it('message variants are a polite live status region', () => {
		const { container } = render(EdgeState, { props: { variant: 'empty', lang: 'en' } });
		const root = container.querySelector('[data-slot="edge-state"]');
		expect(root).toHaveAttribute('role', 'status');
		expect(root).toHaveAttribute('aria-live', 'polite');
	});

	it('error-v1 escalates to an assertive alert region', () => {
		const { container } = render(EdgeState, { props: { variant: 'error-v1', lang: 'en' } });
		const root = container.querySelector('[data-slot="edge-state"]');
		expect(root).toHaveAttribute('role', 'alert');
		expect(root).toHaveAttribute('aria-live', 'assertive');
	});

	it('the verdict glyph is decorative (aria-hidden) — meaning carried by the text', () => {
		const { container } = render(EdgeState, { props: { variant: 'empty-avis', lang: 'fr' } });
		// The glyph span is aria-hidden; the title text is what AT announces.
		const glyph = container.querySelector('[data-slot="state-notice-glyph"]');
		expect(glyph).not.toBeNull();
		expect(glyph).toHaveAttribute('aria-hidden', 'true');
		expect(glyph!.textContent).toBe('○');
		expect(container).toHaveTextContent('Aucun avis n’est signalé dans cette fenêtre.');
		expect(container).not.toHaveTextContent('Le réseau roule normalement');
	});
});

describe('EdgeState — card border treatment', () => {
	it('keeps error-v1 on the normal card border without an alternate-colour top rule', () => {
		const { container } = render(EdgeState, { props: { variant: 'error-v1', lang: 'en' } });
		const root = container.querySelector('[data-slot="edge-state"]');

		expect(root).toHaveAttribute('data-component', 'state-notice');
		expect(root).not.toHaveClass('edge-accent-bar');
		expect((root as HTMLElement).style.getPropertyValue('--edge-rule')).toBe('');
	});

	it.each([
		['stale-offline', 'warning'],
		['no-results', 'neutral'],
		['empty', 'neutral'],
		['empty-avis', 'neutral'],
		['error-v1', 'error'],
	] as const)('%s keeps semantic colour in content, never in a top frame rule', (variant, tone) => {
		const { container } = render(EdgeState, { props: { variant, lang: 'en' } });
		const root = container.querySelector('[data-slot="edge-state"]');

		expect(root).toHaveAttribute('data-component', 'state-notice');
		expect(root).toHaveAttribute('data-tone', tone);
		expect(root).toHaveAttribute('data-presentation', 'responsive');
		expect(root).not.toHaveClass('edge-accent-bar');
		expect((root as HTMLElement).style.getPropertyValue('--edge-rule')).toBe('');
	});

	it('accepts a compact silo presentation without changing its state semantics', () => {
		const { container } = render(EdgeState, {
			props: { variant: 'empty', lang: 'en', presentation: 'silo' },
		});
		const root = container.querySelector('[data-slot="edge-state"]');
		expect(root).toHaveAttribute('data-variant', 'empty');
		expect(root).toHaveAttribute('data-presentation', 'silo');
	});
});

describe('EdgeState — error-v1 retry affordance', () => {
	it('renders the retry button (FR) and fires onRetry on click', async () => {
		const onRetry = vi.fn();
		const { getByText } = render(EdgeState, {
			props: { variant: 'error-v1', lang: 'fr', onRetry },
		});
		const btn = getByText('Réessayer');
		expect(btn).toBeInTheDocument();
		await fireEvent.click(btn);
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it('renders the retry button (EN)', () => {
		const { getByText } = render(EdgeState, {
			props: { variant: 'error-v1', lang: 'en', onRetry: () => {} },
		});
		expect(getByText('Retry')).toBeInTheDocument();
	});

	it('omits the retry button when no onRetry handler is supplied', () => {
		const { queryByText } = render(EdgeState, { props: { variant: 'error-v1', lang: 'en' } });
		expect(queryByText('Retry')).toBeNull();
	});

	it('shows the localized last-MAJ delta on the stale variant when lastUpdated is given', () => {
		const recent = new Date(Date.now() - 4 * 60 * 1000).toISOString(); // 4 min ago
		const { container } = render(EdgeState, {
			props: { variant: 'stale-offline', lang: 'fr', lastUpdated: recent },
		});
		const delta = container.querySelector('[data-slot="edge-stale-delta"]');
		expect(delta).not.toBeNull();
		expect(delta!.textContent).toContain('MAJ');
	});
});

describe('EdgeState — HONEST ABSENCE reason copy (empty variant)', () => {
	it('metro-no-realtime replaces the generic empty copy (EN + FR)', () => {
		const en = render(EdgeState, {
			props: { variant: 'empty', lang: 'en', emptyReason: { key: 'metro-no-realtime' } },
		});
		expect(en.getByText('live positions are not published here')).toBeInTheDocument();
		// The generic empty body must NOT also render.
		expect(en.queryByText('No data has been published for this view yet.')).toBeNull();

		const fr = render(EdgeState, {
			props: { variant: 'empty', lang: 'fr', emptyReason: { key: 'metro-no-realtime' } },
		});
		expect(fr.getByText('les positions en direct ne sont pas publiées ici')).toBeInTheDocument();
	});

	it('closed-opens-at names the FIRST departure (EN + FR)', () => {
		const en = render(EdgeState, {
			props: {
				variant: 'empty',
				lang: 'en',
				emptyReason: { key: 'closed-opens-at', firstDeparture: '06:00' },
			},
		});
		expect(en.getByText('service is closed, opens at 06:00')).toBeInTheDocument();

		const fr = render(EdgeState, {
			props: {
				variant: 'empty',
				lang: 'fr',
				emptyReason: { key: 'closed-opens-at', firstDeparture: '06:00' },
			},
		});
		expect(fr.getByText('service terminé, reprise à 06:00')).toBeInTheDocument();
	});

	it('overnight-opens-at reads "no service at this hour" with FIRST', () => {
		const { getByText } = render(EdgeState, {
			props: {
				variant: 'empty',
				lang: 'en',
				emptyReason: { key: 'overnight-opens-at', firstDeparture: '05:11' },
			},
		});
		expect(getByText('no service at this hour, opens at 05:11')).toBeInTheDocument();
	});

	it('scheduled-silent reads the honest "no vehicle reporting" message', () => {
		const { getByText } = render(EdgeState, {
			props: { variant: 'empty', lang: 'en', emptyReason: { key: 'scheduled-silent' } },
		});
		expect(getByText('scheduled, but nothing is reporting live')).toBeInTheDocument();
	});

	it.each(['error-v1', 'stale-offline', 'skeleton'] as const)(
		'%s takes precedence over a service-window reason',
		(variant) => {
			const { queryByText, getByText } = render(EdgeState, {
				props: {
					variant,
					lang: 'en',
					skeletonDelayMs: 0,
					emptyReason: { key: 'closed-opens-at', firstDeparture: '06:00' },
				},
			});
			expect(queryByText('service is closed, opens at 06:00')).toBeNull();
			expect(
				getByText(variant === 'skeleton' ? 'Loading…' : TITLES[variant].en),
			).toBeInTheDocument();
		},
	);

	it.each([
		['en', 'service has not started yet, opens at 06:37'],
		['fr', 'service pas encore commencé, début à 06:37'],
	] as const)('before-open preserves the first departure in %s', (lang, body) => {
		const { getByText } = render(EdgeState, {
			props: {
				variant: 'empty',
				lang,
				emptyReason: { key: 'before-open', firstDeparture: '06:37' },
			},
		});
		expect(getByText(body)).toBeInTheDocument();
	});

	it.each(['en', 'fr'] as const)(
		'last-seen ages against the shared server clock in %s',
		async (lang) => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-06-15T12:09:00Z'));
			sharedClock.noteServerEpochMs(Date.parse('2026-06-15T12:00:00Z'));
			try {
				const { container } = render(EdgeState, {
					props: {
						variant: 'empty',
						lang,
						emptyReason: { key: 'last-seen', lastSeenIso: '2026-06-15T11:57:00Z' },
					},
				});
				const body = container.querySelector('[data-slot="state-notice-body"]');
				expect(body).toHaveTextContent(
					lang === 'en' ? 'last seen 3 minutes ago' : 'dernière position il y a 3 min',
				);
				await vi.advanceTimersByTimeAsync(60_000);
				expect(body).toHaveTextContent(
					lang === 'en' ? 'last seen 4 minutes ago' : 'dernière position il y a 4 min',
				);
			} finally {
				cleanup();
				sharedClock.noteServerEpochMs(Date.now());
				vi.useRealTimers();
			}
		},
	);

	it('the empty variant with NO reason falls back to the generic honest no-data copy', () => {
		const { getByText } = render(EdgeState, { props: { variant: 'empty', lang: 'en' } });
		expect(getByText('Nothing to show')).toBeInTheDocument();
	});
});
