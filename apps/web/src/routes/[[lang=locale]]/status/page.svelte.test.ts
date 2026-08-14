import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('/status forwards all request-scoped seeds through its thin feature mount', () => {
	const source = readFileSync(
		resolve(process.cwd(), 'src/routes/[[lang=locale]]/status/+page.svelte'),
		'utf8',
	);

	expect(source).toContain('provenanceSeed={data.provenanceSeed ?? undefined}');
	expect(source).toContain('dataHealthSeed={data.dataHealthSeed ?? undefined}');
	expect(source).toContain(
		'historicAvailabilitySeed={data.historicAvailabilitySeed ?? undefined}',
	);
});
