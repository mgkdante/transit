// TerminalChrome.test.ts — the terminal-window chrome primitive, DOM gate.
//
// slice-9.7 A3 aligned this primitive to the yesid.dev recipe: the decorative
// mac traffic-light dots (hardcoded hex) are replaced by a composed three-aspect
// SIGNAL HEAD (StatusDot green/caution/stop) and a hazard Separator rides
// between the titlebar and the body. The prop API (title/tag/status/footer/
// noPadding) is UNCHANGED so all three consumers inherit the chrome untouched.
//
// Gates:
//   - the signal head renders three StatusDots: proceed (lit + pulsing) +
//     caution + stop (unlit at opacity-25), in the signal palette — no
//     hardcoded mac hex survives.
//   - the hazard Separator is present between the titlebar and the body.
//   - the prop API drives the title/tag/status/footer; noPadding toggles the
//     body padding class.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import TerminalChrome from './TerminalChrome.svelte';

const root = (c: HTMLElement) => c.querySelector('[data-slot="terminal-chrome"]') as HTMLElement;
const head = (c: HTMLElement) => c.querySelector('[data-slot="signal-head"]') as HTMLElement;
const dots = (c: HTMLElement) =>
	Array.from(c.querySelectorAll('[data-slot="signal-head"] [data-slot="status-dot"]'));

describe('TerminalChrome — signal head (replaces the mac traffic-light dots)', () => {
	it('renders a three-aspect signal head — proceed + caution + stop', () => {
		const { container } = render(TerminalChrome, { props: { title: 'demo' } });
		const d = dots(container);
		expect(d).toHaveLength(3);
		// Aspect colours ride the interlocking-signal palette (not --primary, not hex).
		expect(d[0]).toHaveClass('bg-[var(--signal-proceed)]');
		expect(d[1]).toHaveClass('bg-[var(--signal-caution)]');
		expect(d[2]).toHaveClass('bg-[var(--signal-stop)]');
	});

	it('lights only the proceed aspect (pulsing); caution + stop sit unlit at 25%', () => {
		const { container } = render(TerminalChrome, { props: { title: 'demo' } });
		const d = dots(container);
		expect(d[0]).toHaveClass('led-pulse');
		expect(d[0]).not.toHaveClass('opacity-25');
		expect(d[1]).toHaveClass('opacity-25');
		expect(d[2]).toHaveClass('opacity-25');
	});

	it('marks the signal head decorative (aria-hidden) — window furniture, not data', () => {
		const { container } = render(TerminalChrome, { props: { title: 'demo' } });
		expect(head(container)).toHaveAttribute('aria-hidden', 'true');
	});
});

describe('TerminalChrome — hazard separator between titlebar and body', () => {
	it('renders a hazard separator (the brand safety-tape stripe)', () => {
		const { container } = render(TerminalChrome, { props: { title: 'demo' } });
		// The hazard Separator paints the repeating hazard-tape gradient inline.
		const stripe = Array.from(container.querySelectorAll('div')).find((el) =>
			(el.getAttribute('style') ?? '').includes('var(--hazard-a)'),
		);
		expect(stripe, 'a hazard-tape stripe should be present').toBeTruthy();
		expect(stripe).toHaveAttribute('aria-hidden', 'true');
	});
});

describe('TerminalChrome — no hardcoded mac traffic-light hex survives', () => {
	it('renders no element painted with the old #ff5f56 / #ffbd2e / #27c93f hexes', () => {
		const { container } = render(TerminalChrome, { props: { title: 'demo' } });
		const html = container.innerHTML.toLowerCase();
		expect(html).not.toContain('#ff5f56');
		expect(html).not.toContain('#ffbd2e');
		expect(html).not.toContain('#27c93f');
	});
});

describe('TerminalChrome — prop API (title/tag/status/footer/noPadding)', () => {
	it('renders the title, tag and status text', () => {
		const { getByText } = render(TerminalChrome, {
			props: { title: 'NETWORK PULSE', tag: 'LIVE', status: '2026-06-21' },
		});
		expect(getByText('NETWORK PULSE')).toBeInTheDocument();
		expect(getByText('LIVE')).toBeInTheDocument();
		expect(getByText('2026-06-21')).toBeInTheDocument();
	});

	it('renders the footer metric items', () => {
		const { getByText } = render(TerminalChrome, {
			props: { title: 'demo', footer: [{ label: 'ISSUED', value: '2026-06-21' }] },
		});
		expect(getByText('ISSUED')).toBeInTheDocument();
		expect(getByText('2026-06-21')).toBeInTheDocument();
	});

	it('drops the body padding class when noPadding is set', () => {
		const off = render(TerminalChrome, { props: { title: 'demo' } });
		expect(off.container.querySelector('.terminal-body')).not.toHaveClass('no-pad');
		const on = render(TerminalChrome, { props: { title: 'demo', noPadding: true } });
		expect(on.container.querySelector('.terminal-body')).toHaveClass('no-pad');
	});

	it('exposes the terminal-chrome data-slot hook', () => {
		const { container } = render(TerminalChrome, { props: { title: 'demo' } });
		expect(root(container)).toBeInTheDocument();
	});
});
