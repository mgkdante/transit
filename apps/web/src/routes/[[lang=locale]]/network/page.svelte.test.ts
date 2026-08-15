import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('/network forwards all request-scoped seeds through its thin feature mount', () => {
	const source = readFileSync(
		resolve(process.cwd(), 'src/routes/[[lang=locale]]/network/+page.svelte'),
		'utf8',
	);

	expect(source).toContain('networkSeed={data.networkSeed ?? undefined}');
	expect(source).toContain('trendSeed={data.trendSeed ?? undefined}');
	expect(source).toContain('provenanceSeed={data.provenanceSeed ?? undefined}');
});
