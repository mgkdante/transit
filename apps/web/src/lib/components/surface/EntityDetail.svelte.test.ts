import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard for the signage-active tab look (yesid StationTabs parity).
// EntityDetail's tab strip renders each bits-ui TabsTrigger through a `child`
// snippet <button> so behavior/ARIA stay on bits-ui while the active VISUAL is the
// theme-invariant metro-signage chip (--signage-bg/--signage-text). A vitest can't
// compile the scoped CSS, so we scan the source for the load-bearing pieces (same
// approach as the tabs-trigger variant guard). The rendered behavior is covered by
// the RouteDetail/StopDetail feature tests that mount the real EntityDetail.
const src = readFileSync(
	join(process.cwd(), 'src/lib/components/surface/EntityDetail.svelte'),
	'utf8',
);

describe('EntityDetail — signage-active tab pattern', () => {
	it('renders each trigger through a bits-ui child snippet (behavior stays on bits-ui)', () => {
		expect(src).toMatch(/\{#snippet child\(\{ props \}\)\}/);
		expect(src).toContain('class:active={t.key === active}');
	});

	it('paints the active tab with the theme-invariant signage chip', () => {
		expect(src).toContain('--signage-bg');
		expect(src).toContain('--signage-text');
	});
});
