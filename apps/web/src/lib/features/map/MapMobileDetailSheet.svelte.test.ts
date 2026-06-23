import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StopIndexEntry } from '$lib/v1/schemas';
import type { StopMapDetail } from './mapSelection';
import MapMobileDetailSheet from './MapMobileDetailSheet.svelte';

const stop: StopIndexEntry = {
	id: 'stop-1',
	name: 'Sherbrooke / Saint-Denis',
	code: '52618',
	lat: 45.51,
	lon: -73.57,
};

const stopDetail: StopMapDetail = {
	kind: 'stop',
	id: 'stop-1',
	title: 'Sherbrooke / Saint-Denis',
	stop,
	departures: [],
	vehicles: [],
	routeTimes: [],
	alerts: [],
};

function baseProps(overrides: Record<string, unknown> = {}) {
	return {
		open: true,
		locale: 'en' as const,
		title: stopDetail.title,
		surfaceKey: `stop:${stop.id}`,
		canGoBack: false,
		onback: () => {},
		selectedDetail: stopDetail,
		notReporting: null,
		onselect: () => {},
		onfilter: () => {},
		onalertselect: () => {},
		...overrides,
	};
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('MapMobileDetailSheet', () => {
	it('renders the selected detail inside the bottom sheet when open', async () => {
		render(MapMobileDetailSheet, { props: baseProps() });

		// The sheet (bits-ui Sheet portal) renders with the detail body.
		await waitFor(() => {
			expect(document.querySelector('[data-slot="bottom-sheet"]')).toBeInTheDocument();
		});
		const body = document.querySelector('[data-slot="bottom-sheet-body"]')!;
		expect(body).toBeInTheDocument();
		// The map selection detail (the stop's title) is the swapped body content.
		expect(body.textContent).toContain(stop.name);
	});

	it('wires the back affordance to the orchestrator back stack only when canGoBack', async () => {
		const onback = vi.fn();
		render(MapMobileDetailSheet, { props: baseProps({ canGoBack: true, onback }) });

		const back = await waitFor(() => {
			const el = document.querySelector<HTMLButtonElement>('[data-slot="bottom-sheet-back"]');
			expect(el).toBeInTheDocument();
			return el!;
		});
		await fireEvent.click(back);
		expect(onback).toHaveBeenCalledTimes(1);
	});

	it('omits the back affordance at the root of the drilldown (no history)', async () => {
		render(MapMobileDetailSheet, { props: baseProps({ canGoBack: false }) });

		await waitFor(() => {
			expect(document.querySelector('[data-slot="bottom-sheet"]')).toBeInTheDocument();
		});
		expect(document.querySelector('[data-slot="bottom-sheet-back"]')).not.toBeInTheDocument();
	});

	it('renders nothing visible while closed', () => {
		render(MapMobileDetailSheet, { props: baseProps({ open: false }) });

		expect(document.querySelector('[data-slot="bottom-sheet-body"]')).not.toBeInTheDocument();
	});
});
