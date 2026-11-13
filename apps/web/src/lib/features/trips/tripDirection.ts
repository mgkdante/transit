interface Direction {
	readonly headsign?: string | null;
	readonly stops?: readonly { id: string; seq: number }[];
}

export function tripDirection(
	reportedStops: readonly string[],
	directions: readonly Direction[],
): string | null {
	const matches = directions.filter((direction) => {
		const stops = [...(direction.stops ?? [])].sort((a, b) => a.seq - b.seq).map((stop) => stop.id);
		const present = new Set(stops);
		let cursor = 0;
		let count = 0;
		for (const id of reportedStops) {
			if (!present.has(id)) continue;
			const next = stops.indexOf(id, cursor);
			if (next < 0) return false;
			cursor = next + 1;
			count += 1;
		}
		return count >= 2;
	});
	return matches.length === 1 && matches[0].headsign?.trim() ? matches[0].headsign : null;
}
