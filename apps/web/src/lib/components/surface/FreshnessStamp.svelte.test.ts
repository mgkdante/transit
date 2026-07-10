import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import FreshnessStamp from './FreshnessStamp.svelte';

// Pin a fixed, skewed serverNow so the relative age is deterministic and proves
// the stamp anchors to the SERVER clock (via the centralized freshnessAgeSeconds),
// not Date.now(). serverNow = generated_utc + 5 minutes → "5 minutes ago". We mock
// BOTH the clock module (freshnessAgeSeconds reads it) and the barrel (the
// component's subscribe call) so the readout is fully deterministic.
const clockStub = vi.hoisted(() => ({
	get now() {
		return Date.parse('2026-06-20T12:05:00Z');
	},
	get serverNow() {
		return Date.parse('2026-06-20T12:05:00Z');
	},
	subscribe: () => () => {},
}));
vi.mock('$lib/stores/clock.svelte', () => ({ sharedClock: clockStub }));
vi.mock('$lib/stores', () => ({ sharedClock: clockStub }));

const GEN = '2026-06-20T12:00:00Z';

describe('FreshnessStamp — live variant', () => {
	it('renders the pulsing LIVE chip with a server-anchored relative age', () => {
		render(FreshnessStamp, { props: { variant: 'live', generatedUtc: GEN, locale: 'en' } });
		const chip = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		expect(chip).not.toBeNull();
		expect(chip.getAttribute('data-variant')).toBe('live');
		// "LIVE" appears twice (the StatusDot's sr-only label + the visible label).
		expect(within(chip).getAllByText('LIVE').length).toBeGreaterThanOrEqual(1);
		expect(chip.querySelector('.freshness-stamp-label')?.textContent).toBe('LIVE');
		// Age derived centrally off the mocked serverNow → exactly "5 minutes ago".
		expect(within(chip).getByText('5 minutes ago')).toBeInTheDocument();
		expect(chip.querySelector('time')).toHaveAttribute('datetime', GEN);
	});

	it('shows the stale note when isStale', () => {
		render(FreshnessStamp, {
			props: { variant: 'live', generatedUtc: GEN, isStale: true, locale: 'en' },
		});
		const chip = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		expect(chip.getAttribute('data-stale')).toBe('true');
		expect(within(chip).getByText(/stale/)).toBeInTheDocument();
	});

	it('lets a caller-supplied ticking ageSeconds drive the readout', () => {
		render(FreshnessStamp, {
			props: { variant: 'live', generatedUtc: GEN, ageSeconds: 120, locale: 'en' },
		});
		const chip = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		// 120s → "2 minutes ago", overriding the internal derivation.
		expect(within(chip).getByText('2 minutes ago')).toBeInTheDocument();
	});
});

describe('FreshnessStamp — updated variant', () => {
	it('keeps the status label on one line inside narrow rail cards', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/surface/FreshnessStamp.svelte'),
			'utf8',
		);
		expect(source).toMatch(
			/\.freshness-stamp-label\s*\{[\s\S]*?flex-shrink:\s*0[\s\S]*?white-space:\s*nowrap/,
		);
	});

	it('renders the calm neutral "Updated" stamp, never the LIVE label', () => {
		render(FreshnessStamp, { props: { variant: 'updated', generatedUtc: GEN, locale: 'en' } });
		const chip = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		expect(chip.getAttribute('data-variant')).toBe('updated');
		expect(within(chip).getByText('Updated')).toBeInTheDocument();
		expect(within(chip).getByText('5 minutes ago')).toBeInTheDocument();
		expect(within(chip).queryByText('LIVE')).toBeNull();
	});

	it('localizes to FR', () => {
		render(FreshnessStamp, { props: { variant: 'updated', generatedUtc: GEN, locale: 'fr' } });
		const chip = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		expect(within(chip).getByText('Mis à jour')).toBeInTheDocument();
		expect(within(chip).getByText('il y a 5 minutes')).toBeInTheDocument();
	});
});

describe('FreshnessStamp — honesty (no timestamp)', () => {
	it('reads the localized "unknown" when there is no resolvable timestamp', () => {
		render(FreshnessStamp, { props: { variant: 'updated', generatedUtc: null, locale: 'en' } });
		const chip = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		expect(within(chip).getByText('unknown')).toBeInTheDocument();
		// No fabricated age / no datetime attribute on the <time>.
		expect(chip.querySelector('time')).not.toHaveAttribute('datetime');
	});

	it('reads "inconnu" in FR with no timestamp', () => {
		render(FreshnessStamp, { props: { variant: 'live', generatedUtc: null, locale: 'fr' } });
		const chip = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		expect(within(chip).getByText('inconnu')).toBeInTheDocument();
	});
});

describe('FreshnessStamp — ≥24h absolute switch + aria-live (doctrine §3.5)', () => {
	it('shows an absolute America/Toronto timestamp at/above 24h, not "ago"', () => {
		// ageSeconds ≥ 86400 → absolute (GEN 12:00Z = 08:00 EDT on Jun 20).
		render(FreshnessStamp, {
			props: { variant: 'updated', generatedUtc: GEN, ageSeconds: 90_000, locale: 'en' },
		});
		const time = document.querySelector('[data-slot="freshness-stamp"] time') as HTMLElement;
		const text = time.textContent ?? '';
		expect(text).not.toMatch(/ago/);
		expect(text).toMatch(/Jun/); // the real month, not a vague "2 days ago"
		expect(text).toMatch(/\d{1,2}:\d{2}/); // a wall-clock time
	});

	it('still shows a relative age under 24h', () => {
		render(FreshnessStamp, {
			props: { variant: 'updated', generatedUtc: GEN, ageSeconds: 3600, locale: 'en' },
		});
		const time = document.querySelector('[data-slot="freshness-stamp"] time') as HTMLElement;
		expect(time.textContent ?? '').toMatch(/ago/);
	});

	it('the calm updated stamp is an aria-live polite region', () => {
		render(FreshnessStamp, { props: { variant: 'updated', generatedUtc: GEN, locale: 'en' } });
		const chip = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		expect(chip.getAttribute('aria-live')).toBe('polite');
	});
});
