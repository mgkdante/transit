// MetricInfo.svelte.test.ts — the (i) affordance, DOM gate.
//
// MetricInfo is a click/focus popover: the trigger toggles a tip + a
// keyboard-reachable deep-link into the explainer. Gates:
//   - the trigger is a real <button> with an accessible name + aria-expanded,
//   - clicking reveals the tip text and the action link (with the right href),
//   - the link is a same-tab in-app nav by default; newTab opts into _blank,
//   - Escape closes the popover.

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import MetricInfo from './MetricInfo.svelte';

const base = {
	tip: 'The share of readings that landed on time.',
	href: '/metrics#otp',
	label: 'About on-time %',
	linkLabel: 'How this is measured',
};

describe('MetricInfo trigger', () => {
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
		expect(screen.queryByRole('tooltip')).toBeInTheDocument();

		await fireEvent.keyDown(trigger, { key: 'Escape' });
		expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
	});
});
