function mark(color: string): string {
	return (
		`<circle cx="16" cy="16" r="14" fill="none" stroke="${color}" stroke-width="2" opacity="0.85"/>` +
		`<circle cx="16" cy="16" r="10.5" fill="${color}"/>`
	);
}

/**
 * The yesid mark, a dot inside its ring, cut for a 16px tab rather than scaled from the large
 * mark: the ring lands on one device pixel and the gap around the dot survives.
 */
export function brandMarkSvg(color: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${mark(color)}</svg>`;
}

/** The mark on an opaque square, for apple-touch-icon and other raster icons. */
export function touchIconSvg(ground: string, color: string, size = 180): string {
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 180 180">` +
		`<rect width="180" height="180" fill="${ground}"/>` +
		`<g transform="translate(24 24) scale(4.125)">${mark(color)}</g></svg>`
	);
}
