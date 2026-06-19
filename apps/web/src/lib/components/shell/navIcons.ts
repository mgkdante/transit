// navIcons — the icon per surface key, shared by every chrome consumer so the
// glyph mapping lives in one place alongside the SURFACE_NAV manifest.
import type { Component } from 'svelte';
import ActivityIcon from '@lucide/svelte/icons/activity';
import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
import MapIcon from '@lucide/svelte/icons/map';
import RouteIcon from '@lucide/svelte/icons/route';
import type { SurfaceNavItem } from '$lib/content/nav';

export const navIcons: Record<SurfaceNavItem['key'], Component> = {
	map: MapIcon,
	lines: RouteIcon,
	stops: CircleStopIcon,
	network: ActivityIcon,
};
