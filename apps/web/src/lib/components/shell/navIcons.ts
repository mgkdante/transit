// navIcons — the icon per surface key, shared by every chrome consumer so the
// glyph mapping lives in one place alongside the SURFACE_NAV + AUDIT_NAV manifests.
import type { Component } from 'svelte';
import ActivityIcon from '@lucide/svelte/icons/activity';
import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
import MapIcon from '@lucide/svelte/icons/map';
import RouteIcon from '@lucide/svelte/icons/route';
import RulerIcon from '@lucide/svelte/icons/ruler';
import HeartPulseIcon from '@lucide/svelte/icons/heart-pulse';
import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
import HistoryIcon from '@lucide/svelte/icons/history';
import BellIcon from '@lucide/svelte/icons/bell';
import type { SurfaceNavItem, AuditNavItem } from '$lib/content/nav';

export const navIcons: Record<SurfaceNavItem['key'], Component> = {
	map: MapIcon,
	lines: RouteIcon,
	stops: CircleStopIcon,
	network: ActivityIcon,
};

// Audit-group glyphs — same lucide treatment as navIcons; one per AUDIT_NAV key.
export const auditIcons: Record<AuditNavItem['key'], Component> = {
	metrics: RulerIcon,
	status: HeartPulseIcon,
	hotspots: TriangleAlertIcon,
	receipt: ReceiptTextIcon,
	repeatOffenders: HistoryIcon,
	alerts: BellIcon,
};
