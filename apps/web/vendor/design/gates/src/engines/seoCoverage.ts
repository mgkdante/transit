export interface CoverageDiffInput {
	expected: Iterable<string>;
	actual: Iterable<string>;
	normalize?: (value: string) => string;
}

export interface CoverageDiff {
	missing: string[];
	extra: string[];
}

function normalizedSet(
	values: Iterable<string>,
	normalize: (value: string) => string,
): Set<string> {
	return new Set(Array.from(values, normalize));
}

export function sitemapCoverage(input: CoverageDiffInput): CoverageDiff {
	const normalize = input.normalize ?? ((value: string) => value);
	const expected = normalizedSet(input.expected, normalize);
	const actual = normalizedSet(input.actual, normalize);
	return {
		missing: [...expected].filter((value) => !actual.has(value)),
		extra: [...actual].filter((value) => !expected.has(value)),
	};
}

export interface OgCoverageInput extends CoverageDiffInput {
	identifiers?: Iterable<string>;
	isValidIdentifier?: (value: string) => boolean;
}

export interface OgCoverage extends CoverageDiff {
	invalid: string[];
}

export function ogCoverage(input: OgCoverageInput): OgCoverage {
	const coverage = sitemapCoverage(input);
	const identifiers = input.identifiers ?? [];
	const invalid = input.isValidIdentifier
		? [...new Set(identifiers)].filter((value) => !input.isValidIdentifier?.(value))
		: [];
	return { ...coverage, invalid };
}
