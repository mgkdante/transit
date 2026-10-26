// Comment blanking + line numbering originated in transit's
// brand-doctrine.test.ts helpers. The two-track contract remains: violations
// are detected on comment-stripped source while allowlist markers are read from
// the original source at the same line index. The bounded state machine below
// deliberately replaces the extracted regular expressions.

/**
 * Blank out Svelte/JS/CSS comment CONTENT in place so doctrine prose (which
 * legitimately NAMES the banned tokens to explain why they're avoided) never
 * trips the scan. Newlines are PRESERVED — every comment char becomes a space —
 * so line numbers stay 1:1 with the original (the allowlist window is checked
 * against the original at the same index).
 */
export function blankComments(src: string): string {
	// The exact consumer measurement and unit rationale live in the package README.
	const maxSourceCodeUnits = 1_048_576;
	if (src.length > maxSourceCodeUnits) {
		throw new Error(
			`blankComments: source length ${src.length} exceeds limit ${maxSourceCodeUnits.toLocaleString('en-US')} UTF-16 code units`,
		);
	}

	const output = src.split('');
	const isNewline = (char: string | undefined) =>
		char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029';
	const blankCompletedComment = (start: number, end: number) => {
		for (let index = start; index < end; index += 1) {
			if (!isNewline(output[index])) output[index] = ' ';
		}
	};

	let cursor = 0;
	let commentStart = -1;
	let state: 'source' | 'html' | 'block' | 'line' = 'source';
	while (cursor < src.length) {
		if (state === 'html') {
			if (src.startsWith('-->', cursor)) {
				cursor += 3;
				blankCompletedComment(commentStart, cursor);
				commentStart = -1;
				state = 'source';
			} else {
				cursor += 1;
			}
			continue;
		}

		if (state === 'block') {
			if (src.startsWith('*/', cursor)) {
				cursor += 2;
				blankCompletedComment(commentStart, cursor);
				commentStart = -1;
				state = 'source';
			} else {
				cursor += 1;
			}
			continue;
		}

		if (state === 'line') {
			if (isNewline(src[cursor])) {
				blankCompletedComment(commentStart, cursor);
				commentStart = -1;
				state = 'source';
				cursor += 1;
			} else {
				cursor += 1;
			}
			continue;
		}

		if (src.startsWith('<!--', cursor)) {
			commentStart = cursor;
			state = 'html';
			cursor += 4;
		} else if (src.startsWith('/*', cursor)) {
			commentStart = cursor;
			state = 'block';
			cursor += 2;
		} else if (src.startsWith('//', cursor) && (cursor === 0 || src[cursor - 1] !== ':')) {
			commentStart = cursor;
			state = 'line';
			cursor += 2;
		} else {
			cursor += 1;
		}
	}
	if (state === 'line') blankCompletedComment(commentStart, cursor);

	return output.join('');
}

/** Split into [lineNo, text] keeping original numbers (for allowlist windows). */
export function numbered(src: string): Array<[number, string]> {
	return src.split('\n').map((line, i) => [i + 1, line]);
}
