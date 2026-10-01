import type { RouteFile } from '$lib/v1';

export function directionHeadsigns(
	directions: RouteFile['directions'] | undefined | null,
): Record<number, string> {
	const byDir: Record<number, string> = {};
	for (const d of directions ?? []) {
		if (d.dir == null) continue;
		const sign = (d.headsign ?? '').trim();
		if (sign && byDir[d.dir] == null) byDir[d.dir] = sign;
	}
	return byDir;
}
