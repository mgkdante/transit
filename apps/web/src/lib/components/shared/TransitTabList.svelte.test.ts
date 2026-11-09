import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import Harness from './__fixtures__/TransitTabsHarness.svelte';
describe.each([false, true])('Transit tabs compact=%s', (compact) => {
	it('keeps one selected tab and supports arrow navigation and roving focus', async () => {
		const view = render(Harness, { compact });
		const detail = view.getByRole('tab', { name: 'Detail' });
		const schedule = view.getByRole('tab', { name: 'Schedule' });
		detail.focus();
		await fireEvent.keyDown(detail, { key: 'ArrowRight' });
		expect(schedule).toHaveFocus();
		expect(schedule).toHaveAttribute('aria-selected', 'true');
		expect(detail).toHaveAttribute('tabindex', '-1');
		expect(view.getByRole('tabpanel')).toHaveTextContent('Schedule content');
		await fireEvent.keyDown(schedule, { key: 'End' });
		expect(view.getByRole('tab', { name: 'Reliability' })).toHaveFocus();
	});
});
