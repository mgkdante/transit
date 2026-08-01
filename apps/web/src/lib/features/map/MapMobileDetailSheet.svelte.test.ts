import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from 'svelte/compiler';
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

const stopDetailWithLadder: StopMapDetail = {
	...stopDetail,
	departures: [
		{ route: '1', trip: 'a', eta_utc: '2026-08-01T12:01:00Z' as IsoUtc, delay_min: 0 },
		{ route: '2', trip: 'b', eta_utc: '2026-08-01T12:02:00Z' as IsoUtc, delay_min: 0 },
		{ route: '3', trip: 'c', eta_utc: '2026-08-01T12:03:00Z' as IsoUtc, delay_min: 0 },
		{ route: '4', trip: 'd', eta_utc: '2026-08-01T12:04:00Z' as IsoUtc, delay_min: 0 },
	],
	routeTimes: [
		{
			route: '1',
			headsign: 'Centre-ville',
			pastTimes: ['11:55'],
			futureTimes: ['12:05'],
			liveDepartures: [],
		},
	],
};

const mobileAlert: Alert = {
	id: 'mobile-alert',
	severity: 'high',
	header_key: 'Your stop',
	description_en: '<p>Board at the temporary stop &amp; follow signs.</p>',
	stops: [stop.id],
};

const stopDetailWithAlert: StopMapDetail = { ...stopDetail, alerts: [mobileAlert] };

function compiledCss(path: string): string {
	return (
		compile(readFileSync(resolve(process.cwd(), path), 'utf8'), {
			filename: path,
			generate: 'client',
			css: 'external',
		}).css?.code ?? ''
	);
}

function installMobileLadderSeam(outerWidthPx: number): HTMLStyleElement {
	const detailCss = compiledCss('src/lib/features/map/MapSelectionDetail.svelte');
	const marker = '@container right-panel';
	const active: string[] = [];
	let base = '';
	let cursor = 0;
	for (;;) {
		const start = detailCss.indexOf(marker, cursor);
		if (start < 0) {
			base += detailCss.slice(cursor);
			break;
		}
		base += detailCss.slice(cursor, start);
		const open = detailCss.indexOf('{', start + marker.length);
		let depth = 1;
		let end = open + 1;
		while (depth > 0 && end < detailCss.length) {
			if (detailCss[end] === '{') depth += 1;
			if (detailCss[end] === '}') depth -= 1;
			end += 1;
		}
		const condition = detailCss.slice(start + marker.length, open).trim();
		const range = condition.match(/\(width\s*<\s*([\d.]+)rem\)/);
		const minimum = condition.match(/\(min-width:\s*([\d.]+)rem\)/);
		const contentWidthPx = outerWidthPx;
		const matches = range
			? contentWidthPx < Number(range[1]) * 16
			: minimum
				? contentWidthPx >= Number(minimum[1]) * 16
				: false;
		if (matches) active.push(detailCss.slice(open + 1, end - 1));
		cursor = end;
	}
	const style = document.createElement('style');
	style.textContent = [
		active.join('\n'),
		compiledCss('src/lib/features/map/detail/DetailStatPills.svelte'),
		compiledCss('src/lib/features/map/detail/DetailSection.svelte'),
		base,
	].join('\n');
	document.head.append(style);
	return style;
}

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

	it.each(['en', 'fr'] as const)(
		'activates every right-panel ladder rung inside the 390px %s mobile sheet',
		async (locale) => {
			const style = installMobileLadderSeam(390);
			try {
				render(MapMobileDetailSheet, {
					props: baseProps({ locale, selectedDetail: stopDetailWithLadder }),
				});
				const body = await waitFor(() => {
					const element = document.querySelector<HTMLElement>('[data-slot="bottom-sheet-body"]');
					expect(element).toBeInTheDocument();
					return element!;
				});
				const sheetCss = compiledCss('src/lib/components/shell/BottomSheet.svelte');
				expect(sheetCss).toMatch(
					/\.bottom-sheet-body[^}]*\{[^}]*container:\s*right-panel\s*\/\s*inline-size/,
				);
				const chips = body.querySelector<HTMLElement>('[data-slot="detail-meta"]')!;
				expect(getComputedStyle(chips).display).toBe('none');
				const routeTimes = body.querySelector<HTMLElement>('[data-slot="detail-route-times"]')!;
				expect(routeTimes).toBeInTheDocument();
				expect(getComputedStyle(routeTimes).display).toBe('none');
				expect(routeTimes.querySelector('[data-slot="detail-schedule-tail"]')).toBeInTheDocument();
				const fullTail = body.querySelector<HTMLElement>('[data-ladder-content]')!;
				expect(fullTail).toBeInTheDocument();
				expect(getComputedStyle(fullTail).visibility).toBe('hidden');
			} finally {
				style.remove();
			}
		},
	);

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
