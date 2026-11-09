import { browser } from '$app/env';
import { snapSize, RIGHT_SIZES } from './panelSizes';

export const DETAIL_PANEL_WIDTH_STORAGE_KEY = 'transit:detail-panel-width';

export const DEFAULT_DETAIL_PANEL_WIDTH = 400;

export const MIN_DETAIL_PANEL_WIDTH = 56;

export const MAX_DETAIL_PANEL_WIDTH = 560;

export function clampDetailPanelWidth(width: number): number {
	if (!Number.isFinite(width)) return DEFAULT_DETAIL_PANEL_WIDTH;
	return snapSize(width, RIGHT_SIZES, DEFAULT_DETAIL_PANEL_WIDTH);
}

export function publishRailOffset(
	element: HTMLElement,
	detailWidthPx: number,
	open: boolean,
	collapsed: boolean,
	dragging: boolean,
): () => void {
	const detailWidth = `${detailWidthPx}px`;

	const effectiveOffset = open ? (collapsed ? '56px' : detailWidth) : '0px';

	const root = element.ownerDocument.documentElement;

	element.style.setProperty('--app-right-detail-offset', detailWidth);
	element.style.setProperty('--map-detail-offset', effectiveOffset);
	root.style.setProperty('--site-header-inset-end', effectiveOffset);
	if (dragging) root.style.setProperty('--site-header-inset-duration', '0ms');
	else root.style.removeProperty('--site-header-inset-duration');

	return () => {
		root.style.setProperty('--site-header-inset-end', '0px');
		root.style.removeProperty('--site-header-inset-duration');
	};
}

export function readStoredDetailPanelWidth(): number {
	if (!browser) return DEFAULT_DETAIL_PANEL_WIDTH;
	try {
		const raw = localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY);
		if (raw == null) return DEFAULT_DETAIL_PANEL_WIDTH;
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) return DEFAULT_DETAIL_PANEL_WIDTH;
		return clampDetailPanelWidth(parsed);
	} catch {
		return DEFAULT_DETAIL_PANEL_WIDTH;
	}
}

export function writeStoredDetailPanelWidth(width: number): void {
	if (!browser) return;
	try {
		Storage.prototype.setItem.call(
			localStorage,
			DETAIL_PANEL_WIDTH_STORAGE_KEY,
			String(clampDetailPanelWidth(width)),
		);
	} catch {
		// Private mode or disabled storage leaves the width in memory.
	}
}
