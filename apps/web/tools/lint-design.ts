import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	brandHexViolations,
	datavizViolations,
	styleRegressionViolations,
	tvOnlyInUiViolations,
	walk,
} from '@yesid/gates';
import {
	TRANSIT_AFFORDANCE_TOKENS,
	TRANSIT_ALLOW_MARKERS,
	TRANSIT_BRAND_HEXES,
	TRANSIT_FORBIDDEN,
	TRANSIT_STYLE_EXEMPTIONS,
	TRANSIT_STYLE_ROOTS,
} from './design-gates';

const src = fileURLToPath(new URL('../src', import.meta.url));
const failures: string[] = [];

const brand = brandHexViolations({ root: src, hexes: TRANSIT_BRAND_HEXES });
if (brand.fileCount === 0) failures.push(`No source files scanned: ${src}`);
for (const violation of brand.violations) failures.push(`Raw brand hex: ${violation}`);

const doctrine = {
	affordanceTokens: TRANSIT_AFFORDANCE_TOKENS,
	allowMarkers: TRANSIT_ALLOW_MARKERS,
	markerWindow: 8,
};
for (const file of walk(join(src, 'lib/components/dataviz'), ['.svelte', '.ts'])) {
	for (const hit of datavizViolations(readFileSync(file, 'utf8'), doctrine)) {
		failures.push(`Affordance token as a data mark in ${relative(src, file)}: ${hit}`);
	}
}

const tv = tvOnlyInUiViolations({ root: src, uiRoots: [join(src, 'lib/components/ui')] });
for (const violation of tv.violations) failures.push(`tv() outside ui/: ${violation}`);

for (const { pattern, reason, hits } of styleRegressionViolations({
	root: src,
	extensions: ['.svelte', '.css'],
	forbidden: TRANSIT_FORBIDDEN,
})) {
	const found = hits
		.map((hit) => hit.split(sep).join('/'))
		.filter((hit) => TRANSIT_STYLE_ROOTS.some((root) => hit.startsWith(root)))
		.filter((hit) => !TRANSIT_STYLE_EXEMPTIONS.everyPattern.some((part) => hit.includes(part)))
		.filter(
			(hit) =>
				pattern !== TRANSIT_STYLE_EXEMPTIONS.measurePattern ||
				!TRANSIT_STYLE_EXEMPTIONS.proseMeasure.some((path) => hit.startsWith(path)),
		);
	if (found.length > 0) failures.push(`${reason}: ${found.join(', ')}`);
}

if (failures.length > 0) {
	console.error(failures.join('\n'));
	process.exit(1);
}
