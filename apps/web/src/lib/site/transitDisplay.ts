import type { OccupancyCode } from '#lib/v1/index.ts';

export function lineLabel(
	id: string,
	routes: readonly { id: string; short: string }[] = [],
	provider?: string,
): string {
	return (
		routes.find((route) => route.id === id)?.short ||
		(provider === 'octranspo' ? id.replace(/^(\d+)-\d+$/, '$1') : id)
	);
}

const abbreviations = new Set(['NB', 'SB', 'EB', 'WB', 'ST', 'O-TRAIN', 'UOTTAWA', 'H.S.', 'AD.']);
const particles = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'au', 'aux', 'sur']);

export function stopDisplayName(name: string): string {
	if (name !== name.toLocaleUpperCase() || !/\p{L}/u.test(name)) return name;
	return name.replace(/[\p{L}\p{N}]+(?:[.'’-][\p{L}\p{N}]+)*\.?/gu, (word) => {
		if (abbreviations.has(word) || /^[A-Z]$/.test(word) || /\d/.test(word)) return word;
		return word
			.split('-')
			.map((part) => {
				if (abbreviations.has(part)) return part;
				const lower = part.toLocaleLowerCase();
				return particles.has(lower) ? lower : lower[0]!.toLocaleUpperCase() + lower.slice(1);
			})
			.join('-');
	});
}

export function hasOccupancy(
	provider: string | undefined,
	vehicles: readonly { occupancy?: OccupancyCode | null }[],
): boolean {
	return provider === 'stm' || provider == null || vehicles.some((v) => v.occupancy != null);
}
