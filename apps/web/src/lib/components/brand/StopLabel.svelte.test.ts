import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import StopLabel from './StopLabel.svelte';

describe('StopLabel', () => {
	it('renders "ARRÊT {stop} · {label}" with a name (the index plate form)', () => {
		render(StopLabel, { props: { stop: '52001', label: 'Berri' } });
		const plate = screen.getByText(/ARR[ÊE]T/).closest('[data-slot="stop-label"]');
		expect(plate).not.toBeNull();
		expect(plate?.textContent).toContain('ARRÊT 52001');
		expect(plate?.textContent).toContain('· Berri');
	});

	it('omits the "·" separator when the label is empty (the meta-chip form)', () => {
		render(StopLabel, { props: { stop: '52001', label: '' } });
		const plate = screen.getByText(/ARR[ÊE]T/).closest('[data-slot="stop-label"]');
		expect(plate?.textContent).toContain('ARRÊT 52001');
		expect(plate?.textContent).not.toContain('·');
	});

	it('omits the separator when the label is absent entirely', () => {
		render(StopLabel, { props: { stop: '52001' } });
		const plate = screen.getByText(/ARR[ÊE]T/).closest('[data-slot="stop-label"]');
		expect(plate?.textContent?.trim()).toBe('ARRÊT 52001');
	});

	it('renders as a real heading element when as="h1" (SectionHeading law)', () => {
		render(StopLabel, { props: { stop: '52001', label: 'Berri', as: 'h1' } });
		expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
	});
});
