import type { Map as MapLibreMap } from 'maplibre-gl';
import { tick } from 'svelte';
import { coveredArea } from './mapCameraCoveredArea';

export const MIN_VISIBLE_SPAN_PX = 240;

export interface MapFocusMeasurementAdapter {
	containerRect(container: HTMLElement): DOMRect;
	chromeInsets?(container: HTMLElement): { left: number; bottom: number; fitLeft?: number };
	headingRect(hero: Element): DOMRect | null;
	detailOffset(hero: Element): string;
	rootFontSize(): number;
	bottomSheetHeight(): number | null;
	requestFrame(callback: FrameRequestCallback): number;
}

export interface MapFocusInset {
	fitPadding: { top: number; right: number; bottom: number; left: number };
	containerWidth: number;
	containerHeight: number;
	topOcclusion: number;
	rightOcclusion: number;
	bottomOcclusion: number;
	pointOffset: [number, number];
	routePadding: { top: number; right: number; bottom: number; left: number };
}

type FocusMap = Pick<MapLibreMap, 'getContainer'>;

const DOM_MEASUREMENT: MapFocusMeasurementAdapter = {
	chromeInsets: (container) => {
		const box = container.getBoundingClientRect();
		const hero = container.closest('.map-hero');
		const rect = (selector: string) => {
			const el = hero?.querySelector(selector);
			const r = el?.getBoundingClientRect();
			return r && r.width > 0 && r.height > 0 ? r : null;
		};
		const panel = rect('.map-filter-panel');
		const controls = [
			rect('.map-filter-pill-container'),
			rect('.map-near'),
			rect('[data-slot="map-north"]'),
		].filter((r) => r !== null);
		return {
			left: panel ? panel.right - box.left : 0,
			// The narrow controls rail leaves the provider framing viewport-centered.
			// Point and route focus still clear its actual covered edge.
			fitLeft: panel && panel.width > 56 ? panel.right - box.left : 0,
			bottom: Math.max(0, ...controls.map((r) => box.bottom - r.top)),
		};
	},
	containerRect: (container) => container.getBoundingClientRect(),
	headingRect: (hero) => hero.querySelector('.map-head')?.getBoundingClientRect() ?? null,
	detailOffset: (hero) => {
		const panel = hero.querySelector('[data-slot="map-detail-overlay"]');
		return panel
			? panel.getBoundingClientRect().width + 'px'
			: getComputedStyle(hero).getPropertyValue('--map-detail-offset');
	},
	rootFontSize: () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
	bottomSheetHeight: () => {
		const sheet = document.querySelector('[data-slot="bottom-sheet"][data-state="open"]');
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
	const heading = hero ? adapter.headingRect(hero) : null;
	const topOcclusion = clampOcclusion(
		heading ? heading.bottom - containerRect.top : 0,
		containerHeight,
	);
	const rawRight = hero ? parseDetailOffset(adapter.detailOffset(hero), adapter.rootFontSize()) : 0;
	const measuredSheetHeight = adapter.bottomSheetHeight();
	const chrome = adapter.chromeInsets?.(container) ?? { left: 0, bottom: 0 };
	const rawBottom =
		measuredSheetHeight === null
			? 0
			: measuredSheetHeight === 0
				? containerHeight * 0.5
				: measuredSheetHeight;
	const rightOcclusion = clampOcclusion(rawRight, containerWidth);
	const bottomOcclusion = clampOcclusion(rawBottom, containerHeight - topOcclusion);

	const { pointOffset, routePadding } = coveredArea(
		{
			top: topOcclusion,
			right: rightOcclusion,
			bottom: bottomOcclusion,
			left: clampOcclusion(chrome.left, containerWidth - rightOcclusion),
		},
		64,
	);
	return {
		fitPadding: coveredArea(
			{
				top: Math.max(0, heading ? heading.bottom - containerRect.top : 0),
				right: Math.max(0, rawRight),
				bottom: Math.max(0, rawBottom, chrome.bottom),
				left: Math.max(0, chrome.fitLeft ?? chrome.left),
			},
			16,
		).routePadding,
		containerWidth,
		containerHeight,
		topOcclusion,
		rightOcclusion,
		bottomOcclusion,
		pointOffset,
		routePadding,
	};
}

export function deferMapFocusInset(
	map: FocusMap,
	consume: (inset: MapFocusInset) => void,
	adapter: MapFocusMeasurementAdapter = DOM_MEASUREMENT,
): void {
	const intentToken = ++latestIntentToken;
	const container = map.getContainer();
	void (async () => {
		await tick();
		await new Promise<void>((resolve) => adapter.requestFrame(() => resolve()));
		if (intentToken !== latestIntentToken) return;
		if (!container.isConnected) return;
		consume(measureMapFocusInset({ getContainer: () => container }, adapter));
	})();
}
