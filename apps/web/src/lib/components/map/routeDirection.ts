import type { RouteDirection, RouteFile, RouteStop } from '$lib/v1/schemas';

const CARDINAL_HEADSIGN_LABELS = new Map([
	['east', 'East'],
	['est', 'East'],
	['west', 'West'],
	['ouest', 'West'],
	['north', 'North'],
	['nord', 'North'],
	['south', 'South'],
	['sud', 'South'],
]);

export interface RouteDirectionVariant {
	readonly key: string;
	readonly featureId: string;
	readonly dir: number;
	readonly headsign: string | null;
	readonly label: string;
	readonly terminalLabel: string | null;
	readonly firstStop: RouteStop | null;
	readonly lastStop: RouteStop | null;
	readonly stops: readonly RouteStop[];
	readonly direction: RouteDirection;
}

function orderedStops(direction: RouteDirection): RouteStop[] {
	return [...(direction.stops ?? [])].sort((a, b) => a.seq - b.seq);
}

function cleanName(value: string | null | undefined): string {
	return (value ?? '').trim().replace(/\s+/g, ' ');
}

function stopName(stop: RouteStop | null): string | null {
	const name = cleanName(stop?.name);
	return name || stop?.id || null;
}

function normalizeHeadsign(value: string | null | undefined): string {
	return cleanName(value).toLowerCase();
}

function riderFacingHeadsign(value: string | null | undefined): string {
	const headsign = cleanName(value);
	return CARDINAL_HEADSIGN_LABELS.get(normalizeHeadsign(headsign)) ?? headsign;
}

function keyToken(value: string | number | null | undefined): string {
	const raw = String(value ?? '').trim().toLowerCase();
	return encodeURIComponent(raw.replace(/\s+/g, '-'));
}

function baseVariantKey(routeId: string, direction: RouteDirection, stops: readonly RouteStop[]): string {
	const first = stops[0] ?? null;
	const last = stops.at(-1) ?? null;
	return [
		routeId,
		direction.dir,
		direction.headsign ?? '',
		first?.id ?? '',
		last?.id ?? '',
		stops.length,
	]
		.map(keyToken)
		.join(':');
}

function terminalLabel(direction: RouteDirection, last: RouteStop | null): string | null {
	const terminal = stopName(last);
	if (terminal) return `toward ${terminal}`;
	const headsign = cleanName(direction.headsign);
	if (headsign && !CARDINAL_HEADSIGN_LABELS.has(normalizeHeadsign(headsign))) return headsign;
	return null;
}

export function routeDirectionVariants(route: RouteFile): RouteDirectionVariant[] {
	const directions = route.directions ?? [];
	const dirCounts = new Map<number, number>();
	for (const direction of directions) {
		dirCounts.set(direction.dir, (dirCounts.get(direction.dir) ?? 0) + 1);
	}

	const baseCounts = new Map<string, number>();
	const bases = directions.map((direction) => baseVariantKey(route.id, direction, orderedStops(direction)));
	for (const base of bases) baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);

	return directions.map((direction, index) => {
		const stops = orderedStops(direction);
		const base = bases[index];
		const key = (baseCounts.get(base) ?? 0) > 1 ? `${base}:${index}` : base;
		const firstStop = stops[0] ?? null;
		const lastStop = stops.at(-1) ?? null;
		const terminal = terminalLabel(direction, lastStop);
		const headsign = riderFacingHeadsign(direction.headsign);
		const fallback = headsign || `Direction ${direction.dir}`;
		const duplicateDir = (dirCounts.get(direction.dir) ?? 0) > 1;

		return {
			key,
			featureId: duplicateDir ? key : `${route.id}:${direction.dir}`,
			dir: direction.dir,
			headsign: headsign || null,
			label: terminal ?? fallback,
			terminalLabel: terminal,
			firstStop,
			lastStop,
			stops,
			direction,
		};
	});
}
