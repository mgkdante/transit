export function foldDiacritics(value: string | null | undefined): string {
	return (value ?? '')
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

export function foldSearchText(value: string | null | undefined): string {
	return foldDiacritics(value)
		.replace(/[-_/.,'’]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function tokenize(value: string | null | undefined): string[] {
	const folded = foldSearchText(value);
	return folded ? folded.split(' ') : [];
}

export function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const item of items) {
		const k = key(item);
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(item);
	}
	return out;
}

export function tokenMatchScore(
	haystacks: readonly (string | null | undefined)[],
	query: string,
): number | null {
	const q = foldSearchText(query);
	if (!q) return null;

	const folded = haystacks.map((h) => foldSearchText(h)).filter((h) => h.length > 0);
	if (folded.length === 0) return null;

	if (folded.some((h) => h === q)) return 0;
	if (folded.some((h) => h.startsWith(q))) return 1;
	if (folded.some((h) => h.includes(q))) return 2;

	const tokens = q.split(' ');
	if (folded.some((h) => tokens.every((token) => h.includes(token)))) return 3;

	return null;
}
