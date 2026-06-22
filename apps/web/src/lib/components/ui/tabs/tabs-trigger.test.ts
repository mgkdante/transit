import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard for the dead active-tab indicator: bits-ui v2 emits
// data-state="active" on the selected trigger (verified in its source), so the
// Tailwind variant MUST be `data-[state=active]:`. The old `data-active:` matched
// a nonexistent [data-active] attribute, so the active lift + underline never
// painted on /route and /stop. A vitest can't compile Tailwind, so we scan the
// source for the correct selector (same approach as the no-em-dash gate). Read via
// process.cwd() (the apps/web package dir under vitest) to stay env-agnostic.
const src = readFileSync(
	join(process.cwd(), 'src/lib/components/ui/tabs/tabs-trigger.svelte'),
	'utf8',
);

describe('tabs-trigger active-state variant', () => {
	it('targets data-[state=active] (what bits-ui v2 emits)', () => {
		expect(src).toContain('data-[state=active]:');
	});
	it('never reintroduces the dead data-active: variant', () => {
		expect(src).not.toMatch(/data-active:/);
	});
});
