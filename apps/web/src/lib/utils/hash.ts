export function hashStr(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

export function hashUnit(id: string): number {
	return hashStr(id) / 0x100000000;
}

export function hashJitter(id: string, band = 4): number {
	return (hashUnit(id) * 2 - 1) * band;
}
