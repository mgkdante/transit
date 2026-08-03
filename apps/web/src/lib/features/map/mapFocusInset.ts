import type { Map as MapLibreMap } from 'maplibre-gl';
import { tick } from 'svelte';
import { mapOwnerBoundary, reportCleanupFailure } from '$lib/components/map/mapOwnerBoundary';

export const MIN_VISIBLE_SPAN_PX = 240;

export interface MapFocusMeasurementAdapter {
	containerRect(container: HTMLElement): DOMRect;
	detailOffset(hero: Element): string;
	rootFontSize(): number;
	bottomSheetHeight(): number | null;
	requestFrame(callback: FrameRequestCallback): number;
}

export interface MapFocusInset {
	containerWidth: number;
	containerHeight: number;
	rightOcclusion: number;
	bottomOcclusion: number;
	pointOffset: [number, number];
	routePadding: { top: number; right: number; bottom: number; left: number };
}

type FocusMap = Pick<MapLibreMap, 'getContainer'>;

const DOM_MEASUREMENT: MapFocusMeasurementAdapter = {
	containerRect: (container) => container.getBoundingClientRect(),
	detailOffset: (hero) => getComputedStyle(hero).getPropertyValue('--map-detail-offset'),
	rootFontSize: () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
	bottomSheetHeight: () => {
		const sheet = document.querySelector('[data-slot="bottom-sheet"]');
		return sheet ? sheet.getBoundingClientRect().height : null;
	},
	requestFrame: (callback) => requestAnimationFrame(callback),
};

let latestIntentToken = 0;

function clampOcclusion(raw: number, containerSpan: number): number {
	const finiteRaw = Number.isFinite(raw) ? raw : 0;
	return Math.min(Math.max(finiteRaw, 0), Math.max(0, containerSpan - MIN_VISIBLE_SPAN_PX));
}

function parseDetailOffset(value: string, rootFontSize: number): number {
	const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))(px|rem)$/u);
	if (!match) return 0;
	const amount = Number(match[1]);
	if (!Number.isFinite(amount)) return 0;
	return match[2] === 'rem' ? amount * rootFontSize : amount;
}

export function measureMapFocusInset(
	map: FocusMap,
	adapter: MapFocusMeasurementAdapter = DOM_MEASUREMENT,
): MapFocusInset {
	const container = map.getContainer();
	const containerRect = adapter.containerRect(container);
	const containerWidth = Math.max(0, containerRect.width);
	const containerHeight = Math.max(0, containerRect.height);
	const hero = container.closest('.map-hero');
	const rawRight = hero ? parseDetailOffset(adapter.detailOffset(hero), adapter.rootFontSize()) : 0;
	const measuredSheetHeight = adapter.bottomSheetHeight();
	const rawBottom =
		measuredSheetHeight === null
			? 0
			: measuredSheetHeight === 0
				? containerHeight * 0.5
				: measuredSheetHeight;
	const rightOcclusion = clampOcclusion(rawRight, containerWidth);
	const bottomOcclusion = clampOcclusion(rawBottom, containerHeight);

	return {
		containerWidth,
		containerHeight,
		rightOcclusion,
		bottomOcclusion,
		pointOffset: [
			rightOcclusion === 0 ? 0 : -rightOcclusion / 2,
			bottomOcclusion === 0 ? 0 : -bottomOcclusion / 2,
		],
		routePadding: {
			top: 64,
			right: 64 + rightOcclusion,
			bottom: 64 + bottomOcclusion,
			left: 64,
		},
	};
}

export function deferMapFocusInset(
	map: FocusMap,
	consume: (inset: MapFocusInset) => void,
	adapter: MapFocusMeasurementAdapter = DOM_MEASUREMENT,
	reporter: (error: unknown) => unknown = (error) =>
		reportCleanupFailure('Map focus inset failed', error),
): void {
	const intentToken = ++latestIntentToken;
	const container = map.getContainer();
	mapOwnerBoundary(
		'Map focus inset',
		[
			{
				release: async () => {
					await tick();
					await new Promise<void>((resolve) => adapter.requestFrame(() => resolve()));
					if (intentToken !== latestIntentToken) return;
					if (!container.isConnected) return;
					consume(measureMapFocusInset({ getContainer: () => container }, adapter));
				},
				retry: false,
			},
		],
		reporter,
	)();
}
