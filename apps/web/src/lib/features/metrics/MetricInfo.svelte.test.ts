// MetricInfo.svelte.test.ts — the (i) affordance, DOM gate.
//
// MetricInfo is a click/focus popover: the trigger toggles a tip + a
// keyboard-reachable deep-link into the explainer. Gates:
//   - the trigger is a real <button> with an accessible name + aria-expanded,
//   - clicking reveals the tip text and the action link (with the right href),
//   - the link is a same-tab in-app nav by default; newTab opts into _blank,
//   - Escape closes the popover.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MetricInfo from './MetricInfo.svelte';

const base = {
	tip: 'The share of readings that landed on time.',
	href: '/metrics#otp',
	label: 'About on-time %',
	linkLabel: 'How this is measured',
};

const source = readFileSync(
	resolve(process.cwd(), 'src/lib/features/metrics/MetricInfo.svelte'),
	'utf-8',
);

describe('MetricInfo trigger', () => {
	it('keeps the shared dashboard and network information popover free of colored glow', () => {
		const popoverRule = source.match(/\.metric-info__pop\s*\{([\s\S]*?)\n\t\}/)?.[1] ?? '';

		expect(popoverRule).not.toMatch(
			/box-shadow:[^;]*(?:--shadow-(?:card|section|glow)|--(?:primary|accent|glow))[^;]*;/,
		);
		expect(popoverRule).toMatch(/box-shadow:[^;]*rgb\(0 0 0 \/[^;]*;/);
	});

	it('is a button with an accessible name and starts collapsed', () => {
		render(MetricInfo, { props: base });
		const trigger = screen.getByRole('button', { name: 'About on-time %' });
		expect(trigger).toBeInTheDocument();
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
	});

	it('reveals the tip and a deep link to the metric anchor on click', async () => {
		render(MetricInfo, { props: base });
		const trigger = screen.getByRole('button', { name: 'About on-time %' });

		await fireEvent.click(trigger);

		expect(trigger).toHaveAttribute('aria-expanded', 'true');
		expect(trigger).toHaveAttribute('aria-controls');
		const popover = screen.getByRole('dialog', { name: 'About on-time %' });
		expect(popover).toHaveAttribute('id', trigger.getAttribute('aria-controls'));
		expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
		expect(screen.getByText('The share of readings that landed on time.')).toBeInTheDocument();
		const link = screen.getByRole('link', { name: /How this is measured/ });
		expect(link).toHaveAttribute('href', '/metrics#otp');
		// In-app, same-tab nav by default (no target).
		expect(link).not.toHaveAttribute('target');
	});

	it('opens the link in a new tab only when newTab is set', async () => {
		render(MetricInfo, { props: { ...base, newTab: true } });
		await fireEvent.click(screen.getByRole('button', { name: 'About on-time %' }));
		const link = screen.getByRole('link', { name: /How this is measured/ });
		expect(link).toHaveAttribute('target', '_blank');
		expect(link).toHaveAttribute('rel', 'noopener noreferrer');
	});

	it('closes on Escape', async () => {
		render(MetricInfo, { props: base });
		const trigger = screen.getByRole('button', { name: 'About on-time %' });

		await fireEvent.click(trigger);
		expect(screen.queryByRole('dialog')).toBeInTheDocument();

		await fireEvent.keyDown(trigger, { key: 'Escape' });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
	});
});

describe('MetricInfo hover group', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('STAYS open when the pointer moves from the trigger onto the tip (the link is reachable)', async () => {
		vi.useFakeTimers();
		const { container } = render(MetricInfo, { props: base });
		const root = container.querySelector('.metric-info') as HTMLElement;

		// Hover the group → opens.
		await fireEvent.mouseEnter(root);
		expect(screen.getByRole('dialog')).toBeInTheDocument();

		// Pointer crosses the gap toward the tip: leaving the trigger schedules a
		// short grace close, but re-entering the group (onto the tip) inside the
		// grace window cancels it, so the in-popover link stays reachable.
		await fireEvent.mouseLeave(root);
		await fireEvent.mouseEnter(root);

		vi.advanceTimersByTime(200);
		expect(screen.queryByRole('dialog')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /How this is measured/ })).toBeInTheDocument();
	});

	it('dismisses after the grace window once the pointer has left for good', async () => {
		vi.useFakeTimers();
		const { container } = render(MetricInfo, { props: base });
		const root = container.querySelector('.metric-info') as HTMLElement;

		await fireEvent.mouseEnter(root);
		expect(screen.getByRole('dialog')).toBeInTheDocument();

		// Leave and never come back: the grace timer elapses and it closes.
		await fireEvent.mouseLeave(root);
		expect(screen.queryByRole('dialog')).toBeInTheDocument(); // still open during grace
		await vi.advanceTimersByTimeAsync(200);
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
});
