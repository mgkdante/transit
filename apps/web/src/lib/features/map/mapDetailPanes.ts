import { browser } from '$app/environment';

export const DETAIL_PANEL_WIDTH_STORAGE_KEY = 'transit:detail-panel-width';

export const DETAIL_RAIL_STORAGE_KEY = 'transit:detail-rail';

export const DEFAULT_DETAIL_PANEL_WIDTH = 360;

export const MIN_DETAIL_PANEL_WIDTH = 300;

export const MAX_DETAIL_PANEL_WIDTH = 560;

export function clampDetailPanelWidth(width: number): number {
	if (!Number.isFinite(width)) return DEFAULT_DETAIL_PANEL_WIDTH;
	return Math.min(Math.max(Math.round(width), MIN_DETAIL_PANEL_WIDTH), MAX_DETAIL_PANEL_WIDTH);
}

export function publishRailOffset(
	element: HTMLElement,
	detailWidthPx: number,
	open: boolean,
	collapsed: boolean,
	dragging: boolean,
): () => void {
	const detailWidth = `${detailWidthPx}px`;
	const effectiveOffset = open ? (collapsed ? 'var(--size-detail-rail)' : detailWidth) : '0px';
	const root = element.ownerDocument.documentElement;

	element.style.setProperty('--app-right-detail-offset', detailWidth);
	element.style.setProperty('--map-detail-offset', effectiveOffset);
	root.style.setProperty('--app-effective-rail-offset', effectiveOffset);
	if (dragging) root.style.setProperty('--app-rail-offset-duration', '0ms');
	else root.style.removeProperty('--app-rail-offset-duration');

	return () => {
		root.style.setProperty('--app-effective-rail-offset', '0px');
		root.style.removeProperty('--app-rail-offset-duration');
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

export function readStoredDetailRail(): string | null {
	if (!browser) return null;
	try {
		const value = localStorage.getItem(DETAIL_RAIL_STORAGE_KEY);
		return value ? value : null;
	} catch {
		return null;
	}
}

export function writeStoredDetailRail(surfaceKey: string): void {
	if (!browser) return;
	try {
		Storage.prototype.setItem.call(localStorage, DETAIL_RAIL_STORAGE_KEY, surfaceKey);
	} catch {
		// Private mode or disabled storage leaves the collapse state in memory.
	}
}

export function clearStoredDetailRail(): void {
	if (!browser) return;
	try {
		localStorage.removeItem(DETAIL_RAIL_STORAGE_KEY);
	} catch {
		// Private mode or disabled storage leaves the collapse state in memory.
	}
}
