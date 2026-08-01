import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Alert, IsoUtc, StopIndexEntry } from '$lib/v1/schemas';
import type { StopMapDetail, VehicleMapDetail } from './mapSelection';
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

const mobileAlert: Alert = {
	id: 'mobile-alert',
	severity: 'high',
	header_key: 'Your stop',
	description_en: '<p>Board at the temporary stop &amp; follow signs.</p>',
	stops: [stop.id],
};

const stopDetailWithAlert: StopMapDetail = { ...stopDetail, alerts: [mobileAlert] };

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
	it('forwards one supplied identity and a real footer action into the BottomSheet slots', async () => {
		const identity = createRawSnippet(() => ({ render: () => '<span>Bus veh-mobile</span>' }));
		const footer = createRawSnippet(() => ({
			render: () => '<a data-slot="detail-footer-action" href="/trip/trip-mobile">Open trip</a>',
		}));
		render(MapMobileDetailSheet, { props: baseProps({ identity, footer }) });

		await waitFor(() => {
			expect(document.querySelector('[data-slot="bottom-sheet"]')).toBeInTheDocument();
		});
		expect(document.querySelector('[data-slot="sheet-title"]')).toHaveTextContent('Bus veh-mobile');
		expect(document.querySelectorAll('[data-slot="sheet-title"]')).toHaveLength(1);
		const sheetFooter = document.querySelector('[data-slot="bottom-sheet-footer"]')!;
		expect(sheetFooter).toContainElement(
			document.querySelector('[data-slot="detail-footer-action"]'),
		);
		expect(sheetFooter.querySelector('[data-slot="detail-footer-action"]')).toHaveAttribute(
			'href',
			'/trip/trip-mobile',
		);
	});

	it('builds the honest default footer action outside the body when the selected detail has a target', async () => {
		render(MapMobileDetailSheet, { props: baseProps() });

		const action = await waitFor(() => {
			const node = document.querySelector<HTMLAnchorElement>(
				'[data-slot="bottom-sheet-footer"] [data-slot="detail-footer-action"]',
			);
			expect(node).toBeInTheDocument();
			return node!;
		});
		expect(action).toHaveAttribute('href', '/stop/stop-1');
		expect(action).toHaveAccessibleName('Open the full analysis for stop stop-1');
		expect(
			document.querySelector('[data-slot="bottom-sheet-body"] [data-slot="detail-footer-action"]'),
		).not.toBeInTheDocument();
	});

	it('renders no footer slot or action for an open vehicle with neither trip nor route', async () => {
		const noTargetVehicle = {
			kind: 'vehicle',
			id: 'veh-no-target',
			title: 'Bus veh-no-target',
			vehicle: {
				id: 'veh-no-target',
				lat: 45.5,
				lon: -73.6,
				status: 'unknown',
				updated_utc: '2026-06-15T00:00:00Z' as IsoUtc,
				route: null,
				trip: null,
				next_stop: null,
				bearing: null,
				delay_min: null,
				occupancy: null,
			},
			trip: null,
			route: null,
			routeDirection: null,
			routeDirectionVariant: null,
			nextStop: null,
			nextStopAbsence: 'end-of-route',
			pastStops: [],
			nextStops: [],
			alerts: [],
			routeType: null,
		} as VehicleMapDetail;
		render(MapMobileDetailSheet, { props: baseProps({ selectedDetail: noTargetVehicle }) });

		await waitFor(() => {
			expect(document.querySelector('[data-slot="bottom-sheet"]')).toBeInTheDocument();
		});
		expect(
			document.querySelector('[data-slot="bottom-sheet-safe-area"]')?.getAttribute('style'),
		).toContain('env(safe-area-inset-bottom)');
		expect(document.querySelector('[data-slot="bottom-sheet-footer"]')).not.toBeInTheDocument();
		expect(document.querySelector('[data-slot="detail-footer-action"]')).not.toBeInTheDocument();
	});
	it('renders the selected detail inside the bottom sheet when open', async () => {
		render(MapMobileDetailSheet, { props: baseProps() });

		// The sheet (bits-ui Sheet portal) renders with the detail body.
		await waitFor(() => {
			expect(document.querySelector('[data-slot="bottom-sheet"]')).toBeInTheDocument();
		});
		const body = document.querySelector('[data-slot="bottom-sheet-body"]')!;
		expect(body).toBeInTheDocument();
		expect(document.querySelector('[data-slot="sheet-title"]')).toHaveTextContent(stop.name);
	});

	it('owns the localized identity and forwards retained-detail retry state to the body', async () => {
		const onrefresh = vi.fn();
		render(MapMobileDetailSheet, {
			props: baseProps({
				title: 'Wrong shell title',
				selectionPresence: 'missing-grace',
				selectionSourceHealth: 'failed',
				onrefresh,
			}),
		});

		expect(await screen.findByText(stop.name)).toBeInTheDocument();
		expect(screen.getByText('Live detail is unavailable')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(onrefresh).toHaveBeenCalledTimes(1);
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

	it('opens the source-message alert action without redirecting or replacing mobile detail/back', async () => {
		const onalertselect = vi.fn();
		const onback = vi.fn();
		const locationBeforeTap = window.location.href;
		render(MapMobileDetailSheet, {
			props: baseProps({
				selectedDetail: stopDetailWithAlert,
				canGoBack: true,
				onback,
				onalertselect,
			}),
		});

		const alertButton = await waitFor(() =>
			screen.getByRole('button', {
				name: 'Select alert Board at the temporary stop & follow signs.',
			}),
		);
		await fireEvent.click(alertButton);

		expect(onalertselect).toHaveBeenCalledTimes(1);
		expect(onalertselect.mock.calls[0]?.[0]).toBe(mobileAlert);
		expect(window.location.href).toBe(locationBeforeTap);
		expect(document.querySelector('[data-slot="sheet-title"]')).toHaveTextContent(stop.name);
		const back = document.querySelector<HTMLButtonElement>('[data-slot="bottom-sheet-back"]');
		expect(back).toBeInTheDocument();
		await fireEvent.click(back!);
		expect(onback).toHaveBeenCalledTimes(1);
	});

	it('renders nothing visible while closed', () => {
		render(MapMobileDetailSheet, { props: baseProps({ open: false }) });

		expect(document.querySelector('[data-slot="bottom-sheet-body"]')).not.toBeInTheDocument();
	});
});
