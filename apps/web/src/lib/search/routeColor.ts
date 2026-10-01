const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function routeColor(raw: string | null | undefined): string | null {
	if (raw == null) return null;
	const trimmed = raw.trim();
	const m = HEX_RE.exec(trimmed);
	if (!m) return null;
	let hex = m[1].toLowerCase();
	if (hex.length === 3) {
		hex = hex
			.split('')
			.map((c) => c + c)
			.join('');
	}
	return `#${hex}`;
}
