# Metrics and Status Collapsible Article Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Transit `/metrics` and `/status` use the exact yesid.dev two-button article controls and readable collapsible cards across the left rail, center column, and right rail.

**Architecture:** Keep the shared Transit `ArticleHeader`, `DetailShell`, `TocNav`, and `CollapsibleSection`. Port the yesid.dev quiet-control contract exactly while retaining the Transit storage key and explicitly scoped close/open signals. Page controllers own responsive duplicate rail state, card-specific open signals, and async hash navigation; status section components become body-only presenters beneath one parent card title.

**Tech Stack:** Svelte 5 runes, SvelteKit, TypeScript, bits-ui Collapsible, Vitest, Testing Library, DTCG design tokens, Bun, Chrome DevTools Protocol.

## Global Constraints

- Scope is only `/metrics`, `/fr/metrics`, `/status`, and `/fr/status`.
- The header control row contains exactly two section controls, in this order.
- English copy is exactly `Collapse all` / `Expand all` and `Always start collapsed` / `Don't start collapsed`.
- French copy is exactly `Tout replier` / `Tout déplier` and `Toujours replier` / `Ne plus replier`.
- Controls are plain buttons with `data-collapsed` and `data-remembered`; never add `role="switch"`, `aria-checked`, or `aria-pressed`.
- Preserve the existing `transit:quiet-mode` localStorage key.
- A fresh unremembered article opens all participating cards; mounting another unremembered article resets the page-level bulk mode to open.
- Remembering immediately collapses and persists; forgetting only removes persistence and does not change the current card state.
- The first button controls the ToC card, every visible center card, every nested card, and every rendered right-rail/mobile-summary card.
- Individual card toggles do not rewrite the bulk-mode label.
- Exact long-form prose is `1.0625rem` with `1.8` line height below 1024 px and `1.125rem` with `1.9` line height at 1024 px and above.
- Card headings remain `1.125rem`, weight 700; normal card-body horizontal padding remains 24 px.
- Compact right-rail explanatory prose is `0.95rem` with `1.45` line height.
- Use content-specific stacks, lists, definition rows, chips, and responsive grids. Do not force all card bodies into one grid pattern.
- Do not add a Transit scroll journey, vertical edge titles, text glow, fabricated values, or new data claims.
- Preserve the shared blueprint library and existing ArticleHeader visual contract.
- English default routes are unprefixed; never introduce `/en/metrics` or `/en/status`.
- Use the running local dev server and the user's chosen Chrome workflow for visual QA.
- Do not push, open a pull request, merge, or deploy before the operator finishes the requested visual pass and explicitly approves publication.

### Full pre-commit gate

Run this entire battery before every implementation commit:

```bash
bun run --cwd apps/web format
bun run --cwd apps/web tokens:build
git diff --check
bun run --cwd apps/web test
bun run --cwd apps/web check
bun run --cwd apps/web lint
bun run --cwd apps/web format:check
bun run --cwd apps/web og:check
bun run --cwd apps/web icons:check
bun run --cwd apps/web build
(cd apps/db && uv run pytest tests && uv run ruff check src tests)
bun run --cwd apps/data-proxy test
```

If a gate exposes a new defect, use `superpowers:systematic-debugging` and add a failing regression test before changing production code.

---

### Task 1: Port the exact yesid.dev two-button contract

**Files:**

- Create: `apps/web/src/lib/components/shared/QuietModeButton.svelte.test.ts`
- Modify: `apps/web/src/lib/components/shared/QuietModeButton.svelte`
- Modify: `apps/web/src/lib/stores/quiet-mode.svelte.ts`
- Modify comments only: `apps/web/src/lib/components/shared/CollapsibleSection.svelte`
- Modify comments only: `apps/web/src/lib/components/shared/TocNav.svelte`
- Modify: `apps/web/src/lib/features/metrics/MetricsExplainer.svelte.test.ts`

**Interfaces:**

- Consumes: `getLocale(): Locale`, `quietModeStore`, and the existing Transit brand tokens.
- Produces: the unchanged `quietModeStore` public API: `enabled`, `remembered`, `closeSignal`, `openSignal`, `toggle()`, `rememberCurrent()`, `forgetDefault()`, `init()`, and `resetForTest()`.
- Produces: `QuietModeButton` with only the existing optional `class` prop and stable `quiet-mode-toggle` / `quiet-mode-remember` test ids.

- [ ] **Step 1: Write failing exact-copy, semantics, and remount tests**

Create `QuietModeButton.svelte.test.ts` with behavior-level assertions:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import QuietModeButton from './QuietModeButton.svelte';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

const localeContext = (locale: 'en' | 'fr') =>
	new Map([[Symbol.for('transit.i18n.locale'), () => locale]]);

function renderControls(locale: 'en' | 'fr' = 'en') {
	return render(QuietModeButton, { context: localeContext(locale) });
}

beforeEach(() => quietModeStore.resetForTest());
afterEach(() => {
	cleanup();
	quietModeStore.resetForTest();
});

describe('QuietModeButton source parity', () => {
	it('uses the exact English action labels and plain-button state hooks', async () => {
		renderControls('en');
		await tick();
		const collapse = screen.getByRole('button', { name: 'Collapse all' });
		expect(collapse).toHaveAttribute('data-collapsed', 'false');
		expect(collapse).not.toHaveAttribute('role', 'switch');
		expect(collapse).not.toHaveAttribute('aria-checked');
		expect(collapse).not.toHaveAttribute('aria-pressed');
		expect(collapse).toHaveAttribute('title', 'Collapse all sections on this page');

		await fireEvent.click(collapse);
		expect(screen.getByRole('button', { name: 'Expand all' })).toHaveAttribute(
			'data-collapsed',
			'true',
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Always start collapsed' }));
		expect(screen.getByRole('button', { name: "Don't start collapsed" })).toHaveAttribute(
			'data-remembered',
			'true',
		);
		expect(localStorage.getItem('transit:quiet-mode')).toBe('true');

		await fireEvent.click(screen.getByRole('button', { name: "Don't start collapsed" }));
		expect(screen.getByRole('button', { name: 'Always start collapsed' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument();
		expect(localStorage.getItem('transit:quiet-mode')).toBeNull();
	});

	it('uses the exact French labels', async () => {
		renderControls('fr');
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: 'Tout replier' }));
		expect(screen.getByRole('button', { name: 'Tout déplier' })).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Toujours replier' }));
		expect(screen.getByRole('button', { name: 'Ne plus replier' })).toBeInTheDocument();
	});

	it('resets unsaved collapsed mode when a new article control mounts', async () => {
		const first = renderControls('en');
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
		expect(quietModeStore.enabled).toBe(true);
		first.unmount();
		renderControls('en');
		await tick();
		expect(quietModeStore.enabled).toBe(false);
		expect(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();
	});

	it('allows the two controls to wrap without shrinking their tap targets', () => {
		const source = readFileSync(new URL('./QuietModeButton.svelte', import.meta.url), 'utf8');
		expect(source).toMatch(
			/@media\s*\(max-width:\s*480px\)[\s\S]*?\.quiet-mode-controls\s*\{[\s\S]*?flex-wrap:\s*wrap/,
		);
		expect(source).toMatch(/min-width:\s*44px[\s\S]*?min-height:\s*44px/);
	});
});
```

Import `readFileSync` from `node:fs` in this test file for the responsive source assertion.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
cd apps/web && bunx vitest run src/lib/components/shared/QuietModeButton.svelte.test.ts
```

Expected: FAIL because the current component exposes `Focus` / `Remember`, switch semantics, a pushpin, and no unremembered remount reset.

- [ ] **Step 3: Replace the control copy and state semantics with the source contract**

Use this exact copy model in `QuietModeButton.svelte`:

```ts
interface QuietCopy {
	readonly collapse: string;
	readonly expand: string;
	readonly collapseTitle: string;
	readonly expandTitle: string;
	readonly remember: string;
	readonly forget: string;
}

const COPY: Record<Locale, QuietCopy> = {
	en: {
		collapse: 'Collapse all',
		expand: 'Expand all',
		collapseTitle: 'Collapse all sections on this page',
		expandTitle: 'Expand all sections on this page',
		remember: 'Always start collapsed',
		forget: "Don't start collapsed",
	},
	fr: {
		collapse: 'Tout replier',
		expand: 'Tout déplier',
		collapseTitle: 'Replier toutes les sections de la page',
		expandTitle: 'Déplier toutes les sections de la page',
		remember: 'Toujours replier',
		forget: 'Ne plus replier',
	},
};

const label = $derived(enabled ? t.expand : t.collapse);
const title = $derived(enabled ? t.expandTitle : t.collapseTitle);
const rememberLabel = $derived(remembered ? t.forget : t.remember);
```

The first button must use `data-collapsed={enabled}` and the source 20×20 broadcast/core SVG. The second must use `data-remembered={remembered}` and the source bookmark path:

```svelte
<path class="r-bookmark" d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.9L6 20V5.5a1 1 0 0 1 1-1z" />
```

Remove switch ARIA state. Port the source `data-collapsed` / `data-remembered` CSS selectors, 20×20 icons, padding, 44 px minimum target, two-pixel brand border, focus ring, active fills/glows, and reduced-motion rules verbatim except for Transit token names that already match. Add the approved narrow-screen adaptation so the two source buttons wrap rather than clip:

```css
@media (max-width: 480px) {
	.quiet-mode-controls {
		width: 100%;
		flex-wrap: wrap;
		justify-content: center;
	}
}
```

Change `quietModeStore.init()` to always restore the stored boolean:

```ts
init(): void {
	const stored = readRemembered();
	remembered = stored;
	setEnabled(stored);
},
```

Keep the `transit:quiet-mode` key. Keep `rememberCurrent()` as `setEnabled(true)` followed by `setRemembered(true)`. Keep `forgetDefault()` storage-only.

Update stale FOCUS comments in `CollapsibleSection.svelte` and `TocNav.svelte` to describe the exact collapse/expand labels and page-scoped signal contract; do not alter their behavior in this task.

Update the existing Metrics tests in the same RED/GREEN cycle so the full suite remains independently green after this shared change. Replace `Focus` / `Remember`, `aria-checked`, and switch-role assertions with the exact labels and `data-collapsed` / `data-remembered` assertions. Keep the existing `metrics-expand-all` expectation in Task 1 because that page-owned third control is removed only in Task 2.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
cd apps/web && bunx vitest run src/lib/components/shared/QuietModeButton.svelte.test.ts
```

Expected: all new tests PASS with no warnings.

- [ ] **Step 5: Run the full pre-commit gate and commit**

Run the Global Constraints pre-commit battery, then:

```bash
git add apps/web/src/lib/components/shared/QuietModeButton.svelte \
  apps/web/src/lib/components/shared/QuietModeButton.svelte.test.ts \
  apps/web/src/lib/components/shared/CollapsibleSection.svelte \
  apps/web/src/lib/components/shared/TocNav.svelte \
  apps/web/src/lib/stores/quiet-mode.svelte.ts \
  apps/web/src/lib/features/metrics/MetricsExplainer.svelte.test.ts
git commit -m "feat(web): match yesid article controls"
```

---

### Task 2: Convert Metrics into the complete collapsible article system

**Files:**

- Modify: `apps/web/tools/tokens/tokens.json`
- Regenerate: `apps/web/src/lib/styles/tokens.css`
- Regenerate: `apps/web/src/app.css`
- Modify: `apps/web/src/lib/features/metrics/MetricsExplainer.svelte`
- Modify: `apps/web/src/lib/features/metrics/MetricsExplainer.svelte.test.ts`
- Modify: `apps/web/src/lib/features/metrics/MetricsExplainer.methodology.svelte.test.ts`
- Modify: `apps/web/src/lib/features/metrics/metrics.copy.ts`

**Interfaces:**

- Consumes: Task 1 `quietModeStore` signals and exact `QuietModeButton`.
- Produces: DTCG tokens `--text-detail-body-mobile: 1.0625rem` and `--text-detail-body-desktop: 1.125rem`.
- Produces: one collapsible Metrics ToC, one opening Method and provenance card, existing metric/live-position/gaps cards, and individual Provenance/Coverage/Freshness rail cards.
- Produces: page-owned `Persisted<boolean>` objects for responsive duplicate rail cards; no duplicate card creates its own same-key rune.

- [ ] **Step 1: Write failing Metrics anatomy and interaction tests**

Update `MetricsExplainer.svelte.test.ts` so the current implementation fails on the approved behavior:

```ts
it('renders exactly the two source controls and no metrics-only third control', async () => {
	const { container } = render(MetricsExplainer);
	const header = container.querySelector('[data-slot="article-header"]') as HTMLElement;
	expect(within(header).getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();
	expect(within(header).getByRole('button', { name: 'Always start collapsed' })).toBeInTheDocument();
	expect(within(header).queryByTestId('metrics-expand-all')).toBeNull();
});

it('places the lede and methodology inside the opening provenance card', () => {
	const { container } = render(MetricsExplainer);
	const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
	const trigger = within(center).getByRole('button', { name: en.provenance.label });
	const card = trigger.closest('[data-slot="card"]') as HTMLElement;
	expect(within(card).getByText(en.lede)).toBeInTheDocument();
	expect(within(card).getByText(en.provenance.body)).toBeInTheDocument();
	expect(card).toHaveAttribute('data-toc', 'metrics-provenance');
});

it('collapses and expands left, center, and both responsive rail mounts', async () => {
	const { container } = render(MetricsExplainer);
	await fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
	for (const trigger of container.querySelectorAll('button.section-header')) {
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
	}
	await fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
	for (const trigger of container.querySelectorAll('button.section-header')) {
		expect(trigger).toHaveAttribute('aria-expanded', 'true');
	}
});

it('keeps desktop and mobile copies of a rail card on one logical open state', async () => {
	render(MetricsExplainer);
	const coverage = screen.getAllByRole('button', { name: en.statRail.coverage.title });
	expect(coverage).toHaveLength(2);
	await fireEvent.click(coverage[0]);
	expect(coverage[0]).toHaveAttribute('aria-expanded', 'false');
	expect(coverage[1]).toHaveAttribute('aria-expanded', 'false');
});
```

Reverse the old provenance deep-link assertion: `metrics-provenance` is now openable. Remove the remaining `metrics-expand-all` expectation and keep the Task 1 plain-button assertions. Keep the existing malformed-hash, metric-content, mobile ToC, remembered preference, and honest-absence coverage.

Add a source/token assertion to `MetricsExplainer.methodology.svelte.test.ts`:

```ts
expect(source).toContain('var(--text-detail-body-mobile)');
expect(source).toContain('var(--text-detail-body-desktop)');
expect(source).toMatch(/line-height:\s*1\.8/);
expect(source).toMatch(/line-height:\s*1\.9/);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd apps/web && bunx vitest run \
  src/lib/features/metrics/MetricsExplainer.svelte.test.ts \
  src/lib/features/metrics/MetricsExplainer.methodology.svelte.test.ts \
  src/tests/design-tokens-drift.test.ts
```

Expected: FAIL because Metrics still has a loose provenance section, plain rail stats, undersized prose, the obsolete third control, and unsynchronized responsive rail state.

- [ ] **Step 3: Add the exact yesid long-form tokens and regenerate**

Add this shared path beneath `text.body` in `apps/web/tools/tokens/tokens.json`:

```json
"detail-body": {
	"mobile": {
		"$type": "dimension",
		"$value": "1.0625rem",
		"$description": "Longform body copy inside article detail cards on mobile."
	},
	"desktop": {
		"$type": "dimension",
		"$value": "1.125rem",
		"$description": "Longform body copy inside article detail cards on desktop."
	}
}
```

Run:

```bash
bun run --cwd apps/web tokens:build
```

Expected: `tokens.css` and the generated `app.css` theme region gain the two matching brand-base variables; motion tokens remain unchanged.

- [ ] **Step 4: Replace Metrics page-owned bulk logic with the shared store**

Delete `bulkCloseSignal`, `allExpanded`, `toggleExpandAll`, and the `metrics-expand-all` button. Delete the obsolete `expand` interface/copy from both locales in `metrics.copy.ts`.

Use these signal and persistence authorities:

```ts
import { persisted } from '$lib/stores';

const cardCloseSignal = $derived(quietModeStore.closeSignal);
const cardOpenSignal = (anchor: string): number =>
	(cardOpenSignals[anchor] ?? 0) + quietModeStore.openSignal;

const railOpen = {
	provenance: persisted('metrics-rail-provenance', true),
	coverage: persisted('metrics-rail-coverage', true),
	freshness: persisted('metrics-rail-freshness', true),
};

function setRailOpen(key: keyof typeof railOpen, next: boolean): void {
	railOpen[key].value = next;
}
```

Delete the separate `focusOpenSignal`. Add `PROVENANCE_ANCHOR` to `openableAnchors`. Keep per-target `openCard()` so ToC and hash intent can open one card while bulk mode stays collapsed. Every center card uses `closeSignal={cardCloseSignal}` and `openSignal={cardOpenSignal(anchor)}` without adding the global open signal a second time. Pass `quietModeStore.closeSignal` and `quietModeStore.openSignal` directly to `TocNav`.

- [ ] **Step 5: Put every Metrics logical block in its card**

Render the opening content as one `CollapsibleSection`:

```svelte
<CollapsibleSection
	title={t.provenance.label}
	anchor={PROVENANCE_ANCHOR}
	sectionKey={cardKey(PROVENANCE_ANCHOR)}
	open={true}
	closeSignal={cardCloseSignal}
	openSignal={cardOpenSignal(PROVENANCE_ANCHOR)}
>
	{#snippet icon()}
		<SectionIcon name="layers" class="h-4 w-4 shrink-0 text-primary" />
	{/snippet}
	<div class="metrics-article-prose">
		<p class="metrics-lede">{t.lede}</p>
		<p class="metrics-preamble">{t.provenance.body}</p>
	</div>
</CollapsibleSection>
```

Move the current conformance badge/stand-down, `metrics-measure`, and `metrics-legend` nodes from the existing provenance section into `metrics-article-prose` immediately after `metrics-preamble`, without changing their data derivation or copy.

Keep every existing metric/live-position/gaps card and pass both shared signals.

Replace each plain rail stat with `CollapsibleSection`. Bind both responsive mounts to the same page-owned rune, for example:

```svelte
<CollapsibleSection
	title={t.statRail.coverage.title}
	bind:open={() => railOpen.coverage.value, (next) => setRailOpen('coverage', next)}
	closeSignal={quietModeStore.closeSignal}
	openSignal={quietModeStore.openSignal}
>
	<div class="metrics-stat__body" data-slot="stat-coverage">
		<!-- Keep the real count, family count, and wrapping confidence chips. -->
	</div>
</CollapsibleSection>
```

Render Provenance only when it has a conformance verdict or the localized unavailable message. Render Freshness only when `generated_utc` exists. Coverage always renders. This prevents empty disclosure shells.

- [ ] **Step 6: Apply exact article typography without flattening structured content**

Use the generated tokens for narrative content and retain compact code/row/chip treatments:

```css
.metrics-article-prose,
.metric__prose,
.metric__caveats,
.metrics-live__lede,
.metrics-live__point p,
.metrics-lacunes__lede,
.metrics-lacunes__gap p {
	font-size: var(--text-detail-body-mobile);
	line-height: 1.8;
}

.metrics-stat__note,
.metrics-stat__sub {
	font-size: 0.95rem;
	line-height: 1.45;
}

@media (min-width: 1024px) {
	.metrics-article-prose,
	.metric__prose,
	.metric__caveats,
	.metrics-live__lede,
	.metrics-live__point p,
	.metrics-lacunes__lede,
	.metrics-lacunes__gap p {
		font-size: var(--text-detail-body-desktop);
		line-height: 1.9;
	}
}
```

Keep SQL in `CodeBlock`, confidence items as wrapping chips, and metric subsections as a vertical stack. Any narrow two-column rail treatment must collapse to one column before 320 px clipping.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
cd apps/web && bunx vitest run \
  src/lib/components/shared/QuietModeButton.svelte.test.ts \
  src/lib/components/shared/CollapsibleSection.test.ts \
  src/lib/features/metrics/MetricsExplainer.svelte.test.ts \
  src/lib/features/metrics/MetricsExplainer.methodology.svelte.test.ts \
  src/lib/styles/tokens-aa.test.ts \
  src/tests/design-tokens-drift.test.ts
```

Expected: all focused tests PASS; the two generated detail-body tokens match the vendored brand base.

- [ ] **Step 8: Run the full pre-commit gate and commit**

Run the Global Constraints pre-commit battery, then:

```bash
git add apps/web/tools/tokens/tokens.json \
  apps/web/src/lib/styles/tokens.css apps/web/src/app.css \
  apps/web/src/lib/features/metrics/MetricsExplainer.svelte \
  apps/web/src/lib/features/metrics/MetricsExplainer.svelte.test.ts \
  apps/web/src/lib/features/metrics/MetricsExplainer.methodology.svelte.test.ts \
  apps/web/src/lib/features/metrics/metrics.copy.ts
git commit -m "feat(web): make metrics a collapsible article"
```

---

### Task 3: Turn Status pipeline sections into single-title cards

**Files:**

- Modify: `apps/web/src/lib/features/health/HealthStatus.svelte`
- Modify: `apps/web/src/lib/features/health/HealthStatus.svelte.test.ts`
- Modify: `apps/web/src/lib/features/health/sections/SectionLanes.svelte`
- Modify: `apps/web/src/lib/features/health/sections/SectionFreshness.svelte`
- Modify: `apps/web/src/lib/features/health/sections/SectionSources.svelte`
- Modify: `apps/web/src/lib/features/health/sections/SectionGaps.svelte`
- Modify: `apps/web/src/lib/features/health/sections/SectionNotes.svelte`
- Modify: `apps/web/src/lib/features/health/sections/SectionRetention.svelte`
- Modify: `apps/web/src/lib/features/health/sections/SectionConformance.svelte`
- Modify: `apps/web/src/lib/features/health/sections/SectionEnvelope.svelte`

**Interfaces:**

- Consumes: Task 1 exact controls/store and Task 2 detail-body tokens.
- Produces: eight body-only section components; their parent owns the one `h2`, fixed number, anchor, and disclosure state.
- Produces: `SectionConformance` props `closeSignal: number | null` and `openSignal: number | null` for its meaningful nested disclosure.

- [ ] **Step 1: Write failing Status card and bulk-control tests**

Add these assertions to `HealthStatus.svelte.test.ts` while keeping all current data-honesty tests:

```ts
it('renders the exact two controls and one numbered card per present pipeline section', async () => {
	const { container } = render(HealthStatus);
	const header = container.querySelector('[data-slot="article-header"]') as HTMLElement;
	expect(within(header).getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();
	expect(within(header).getByRole('button', { name: 'Always start collapsed' })).toBeInTheDocument();

	const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
	for (const title of [
		en.lanes.section,
		en.freshness.section,
		en.sources.section,
		en.gaps.section,
		en.pipelineNotes.section,
		en.retention.section,
		en.conformance.section,
		en.envelope.section,
	]) {
		const trigger = within(center).getByRole('button', { name: title });
		const card = trigger.closest('[data-slot="card"]') as HTMLElement;
		expect(card).not.toBeNull();
		expect(within(card).getAllByText(title)).toHaveLength(1);
	}

	await fireEvent.click(within(header).getByRole('button', { name: 'Collapse all' }));
	for (const trigger of center.querySelectorAll('button.section-header')) {
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
	}
});
```

Update the old header assertion that expects no quiet control. Add `quietModeStore.resetForTest()` and clear all `status-*` session keys before/after each test.

- [ ] **Step 2: Run the Status test and verify RED**

Run:

```bash
cd apps/web && bunx vitest run src/lib/features/health/HealthStatus.svelte.test.ts
```

Expected: FAIL because Status has no controls and its sections own duplicate non-card headings.

- [ ] **Step 3: Make all eight section components body-only**

For each `Section*.svelte`, remove the `SectionHeading` import and render. Change its outer semantic heading wrapper to a neutral body wrapper that preserves the existing test hook. Example for freshness:

```svelte
<div class="health-block" data-slot="freshness-section">
	<p class="health-note">{t.note}</p>
</div>
```

Move the component's existing `EntityList` immediately after the note without changing its row markup or data callbacks. Apply the equivalent body-only wrapper to each of the other seven section components while preserving every existing internal list, metric, terminal, badge, and absence node.

Apply the same shape to lanes, sources, gaps, notes, retention, conformance, and envelope. Keep `SectionLanes` inside its diagnostic `TerminalPanel`. Keep the nested conformance disclosure, but extend its props and wiring:

```ts
interface SectionConformanceProps {
	conformance: ProvenanceConformance;
	copy: HealthCopy;
	locale: Locale;
	closeSignal?: number | null;
	openSignal?: number | null;
}
```

```svelte
<CollapsibleSection
	title={t.detailsTitle}
	sectionKey="health-conformance-members"
	open={true}
	{closeSignal}
	{openSignal}
>
```

Change explanatory `.health-note`, gap ledes, and pipeline-note prose to the Task 2 article tokens at `1.8`/`1.9`. Preserve structured row, chip, timestamp, and code scales.

- [ ] **Step 4: Wrap each present section once in `HealthStatus.svelte`**

Import `QuietModeButton`, `quietModeStore`, `CollapsibleSection`, and `SectionIcon`. Add the exact control snippet to `ArticleHeader`. Pass both store signals to `TocNav`.

Use one parent card per presence-gated section. The fixed number is zero-based at the component boundary:

```svelte
<CollapsibleSection
	title={t.lanes.section}
	index={0}
	anchor="health-lanes"
	sectionKey="status-card-health-lanes"
	open={true}
	closeSignal={quietModeStore.closeSignal}
	openSignal={quietModeStore.openSignal + cardOpenSignal('health-lanes')}
>
	<SectionLanes rows={laneRows} copy={t} {locale} />
</CollapsibleSection>
```

Use this exact parent mapping:

| Title | Index | Anchor | Stable key | Body component |
| --- | ---: | --- | --- | --- |
| `t.lanes.section` | 0 | `health-lanes` | `status-card-health-lanes` | `SectionLanes` |
| `t.freshness.section` | 1 | `health-freshness` | `status-card-health-freshness` | `SectionFreshness` |
| `t.sources.section` | 2 | `health-sources` | `status-card-health-sources` | `SectionSources` |
| `t.gaps.section` | 3 | `health-gaps` | `status-card-health-gaps` | `SectionGaps` |
| `t.pipelineNotes.section` | 4 | `health-pipeline-notes` | `status-card-health-pipeline-notes` | `SectionNotes` |
| `t.retention.section` | 5 | `health-retention` | `status-card-health-retention` | `SectionRetention` |
| `t.conformance.section` | 6 | `health-conformance` | `status-card-health-conformance` | `SectionConformance` |
| `t.envelope.section` | 7 | `health-envelope` | `status-card-health-envelope` | `SectionEnvelope` |

Add the page-owned target-open state now so Task 4 navigation can consume it:

```ts
let cardOpenSignals = $state<Record<string, number>>({});
const cardOpenSignal = (id: string): number => cardOpenSignals[id] ?? 0;
function openCard(id: string): void {
	cardOpenSignals = { ...cardOpenSignals, [id]: cardOpenSignal(id) + 1 };
}
```

For the nested conformance disclosure, pass only `quietModeStore.closeSignal` and `quietModeStore.openSignal`. A ToC/deep-link target opens the top-level Conformance card; only the page-wide buttons or its own trigger control the nested details.

- [ ] **Step 5: Run the Status test and verify GREEN**

Run:

```bash
cd apps/web && bunx vitest run src/lib/features/health/HealthStatus.svelte.test.ts
```

Expected: all existing content/honesty tests and the new center-card tests PASS.

- [ ] **Step 6: Run the full pre-commit gate and commit**

Run the Global Constraints pre-commit battery, then:

```bash
git add apps/web/src/lib/features/health/HealthStatus.svelte \
  apps/web/src/lib/features/health/HealthStatus.svelte.test.ts \
  apps/web/src/lib/features/health/sections/Section*.svelte
git commit -m "feat(web): frame status sections as article cards"
```

---

### Task 4: Add Status Overview, independent resources, rail cards, and async navigation

**Files:**

- Modify: `apps/web/src/lib/features/health/HealthStatus.svelte`
- Modify: `apps/web/src/lib/features/health/HealthStatus.svelte.test.ts`
- Create: `apps/web/src/lib/features/health/HealthStatus.async.svelte.test.ts`
- Modify: `apps/web/src/lib/features/health/health.copy.ts`
- Modify: `apps/web/src/lib/components/layout/DetailShell.svelte`
- Modify: `apps/web/src/lib/components/layout/DetailShell.svelte.test.ts`

**Interfaces:**

- Consumes: Task 3 body-only section cards and `openCard(id)`.
- Produces: bilingual `overview.title`, `overview.dailyRecord`, and `overview.liveFeeds` copy.
- Produces: one unnumbered Overview card outside the ToC.
- Produces: page-owned `Persisted<boolean>` state for duplicated Lanes and Feeds rail cards.
- Produces: pending hash state consumed once when an async conditional target first exists.
- Produces: `DetailShell` observer lifecycle keyed by current ToC ids and reconnected after DOM settlement.

- [ ] **Step 1: Write failing Overview, independent-resource, and rail-state tests**

Refactor the existing `createResource` mock fixture to expose independent `data`, `error`, `loading`, and `settled` values for provenance and data health at render time. Add tests for this matrix:

```ts
it('keeps Overview visible with two labelled loading regions', () => {
	provenanceState = { data: null, error: null, loading: true, settled: false };
	dataHealthState = { data: null, error: null, loading: true, settled: false };
	render(HealthStatus);
	const overview = screen
		.getByRole('button', { name: en.overview.title })
		.closest('[data-slot="card"]') as HTMLElement;
	expect(within(overview).getByText(en.lede)).toBeInTheDocument();
	expect(within(overview).getByText(en.overview.dailyRecord)).toBeInTheDocument();
	expect(within(overview).getByText(en.overview.liveFeeds)).toBeInTheDocument();
});

it('does not let daily failure hide valid live cards', () => {
	provenanceState = { data: null, error: new Error('daily down'), loading: false, settled: true };
	dataHealthState = { data: richDataHealth, error: null, loading: false, settled: true };
	render(HealthStatus);
	expect(screen.getByRole('button', { name: en.lanes.section })).toBeInTheDocument();
	expect(screen.getAllByRole('button', { name: en.statRail.lanes.title })).toHaveLength(2);
	expect(screen.getByRole('alert')).toBeInTheDocument();
});

it('does not let live failure hide valid daily cards', () => {
	provenanceState = { data: richProvenance, error: null, loading: false, settled: true };
	dataHealthState = { data: null, error: new Error('live down'), loading: false, settled: true };
	render(HealthStatus);
	expect(screen.getByRole('button', { name: en.freshness.section })).toBeInTheDocument();
	expect(screen.getAllByRole('button', { name: en.statRail.feeds.title })).toHaveLength(2);
});

it('keeps both responsive copies of a Status rail card synchronized', async () => {
	render(HealthStatus);
	const lanes = screen.getAllByRole('button', { name: en.statRail.lanes.title });
	await fireEvent.click(lanes[0]);
	expect(lanes[0]).toHaveAttribute('aria-expanded', 'false');
	expect(lanes[1]).toHaveAttribute('aria-expanded', 'false');
});
```

Add French context assertions for `Vue d’ensemble`, the daily-record label, and live-feed label.

- [ ] **Step 2: Write failing async-hash coverage with the real resource implementation**

Create `HealthStatus.async.svelte.test.ts`. Mock `getProvenance()` and `getDataHealth()` with deferred promises, but do not mock `createResource`. Set `localStorage['transit:quiet-mode']='true'` and `window.location.hash='#health-lanes'`, render Status, then resolve data health. Assert:

```ts
await waitFor(() =>
	expect(screen.getByRole('button', { name: copy.en.lanes.section })).toHaveAttribute(
		'aria-expanded',
		'true',
	),
);
expect(scrollIntoView).toHaveBeenCalledTimes(1);

// A later refresh/re-render of the same target must not steal scroll again.
dataRefresh.bumpEpoch();
await tick();
expect(scrollIntoView).toHaveBeenCalledTimes(1);
```

Also assert a ToC click opens before scroll and reduced motion uses `{ behavior: 'auto', block: 'start' }`.

- [ ] **Step 3: Write a failing dynamic observer lifecycle test**

Mock `observeActiveToc` in `DetailShell.svelte.test.ts`, render with `tocEntries: []`, then rerender with a conditional entry. Expect a second subscription after `tick()` and expect the first cleanup to run. The existing mount-only implementation must fail this test.

- [ ] **Step 4: Run the new tests and verify RED**

Run:

```bash
cd apps/web && bunx vitest run \
  src/lib/features/health/HealthStatus.svelte.test.ts \
  src/lib/features/health/HealthStatus.async.svelte.test.ts \
  src/lib/components/layout/DetailShell.svelte.test.ts
```

Expected: FAIL because Overview, independent boundaries, rail disclosures, pending hashes, reduced-motion navigation, and dynamic observer reconnection do not exist yet.

- [ ] **Step 5: Add bilingual Overview copy and independent resource presentation**

Extend `HealthCopy` and both locales:

```ts
readonly overview: {
	readonly title: string;
	readonly dailyRecord: string;
	readonly liveFeeds: string;
};
```

```ts
// en
overview: { title: 'Overview', dailyRecord: 'Daily record', liveFeeds: 'Live feeds' },
// fr
overview: { title: 'Vue d’ensemble', dailyRecord: 'Bilan quotidien', liveFeeds: 'Flux en direct' },
```

Render an always-present unnumbered card with key `status-overview`. Put the lede inside it. Render each unavailable/loading resource in its own labelled region using `ResourceBoundary`; render no empty label after a resource becomes ready. Put the aggregate lane verdict inside Overview when `laneStat.total > 0`.

```svelte
<CollapsibleSection
	title={t.overview.title}
	sectionKey="status-overview"
	open={true}
	closeSignal={quietModeStore.closeSignal}
	openSignal={quietModeStore.openSignal}
>
	<div class="health-overview">
		<p class="health-lede">{t.lede}</p>
		{#if !prov || provenanceIsEmpty(prov)}
			<div class="health-resource-state" aria-label={t.overview.dailyRecord}>
				<SectionLabel text={t.overview.dailyRecord} variant="metric" />
				<ResourceBoundary resource={provenance} lang={locale} isEmpty={provenanceIsEmpty}>
					{#snippet children(_value)}{/snippet}
				</ResourceBoundary>
			</div>
		{/if}
		{#if !dh || dataHealthIsEmpty(dh)}
			<div class="health-resource-state" aria-label={t.overview.liveFeeds}>
				<SectionLabel text={t.overview.liveFeeds} variant="metric" />
				<ResourceBoundary resource={dataHealth} lang={locale} isEmpty={dataHealthIsEmpty}>
					{#snippet children(_value)}{/snippet}
				</ResourceBoundary>
			</div>
		{:else if laneStat.total > 0}
			<TerminalPanel title={t.aggregate.title}>
				<p class="health-aggregate__verdict">
					<span class="health-aggregate__summary">
						{t.aggregate.summary(String(laneStat.passing), String(laneStat.total))}
					</span>
					<span class="health-aggregate__worst">
						{#if laneStat.worst}
							{t.aggregate.worst(laneStat.worst.label)}
						{:else}
							{t.aggregate.allClear}
						{/if}
					</span>
				</p>
			</TerminalPanel>
		{/if}
	</div>
</CollapsibleSection>
```

Use exact empty predicates so a resolved shell document with no usable content is not mistaken for a healthy populated source:

```ts
function provenanceIsEmpty(value: Provenance): boolean {
	const windows = retentionOf(value);
	return (
		freshnessOf(value).length === 0 &&
		sourcesOf(value).length === 0 &&
		gapsOf(value).length === 0 &&
		pipelineNotesOf(value, METHODOLOGY_METRIC_KEY, t.pipelineNotes.labels).length === 0 &&
		windows.detail == null &&
		windows.aggregate == null &&
		value.conformance == null &&
		value.publish_generation_id == null &&
		value.schema_version == null &&
		value.methodology_version == null
	);
}

function dataHealthIsEmpty(value: DataHealth): boolean {
	return (value.lanes?.length ?? 0) === 0 && (value.feeds?.length ?? 0) === 0;
}
```

Import `DataHealth` as a type. Pass these predicates to the matching `ResourceBoundary`. Show each `overview.dailyRecord` / `overview.liveFeeds` label only while its corresponding boundary is not ready, so a successful source leaves no empty labelled row.

Remove the old provenance boundary that encloses all sections. Leave every derived card gated only by its own existing presence flag. A failed daily resource must not suppress lanes; a failed live resource must not suppress provenance-backed cards.

- [ ] **Step 6: Convert Status rail summaries into synchronized cards**

Create page-owned state:

```ts
const railOpen = {
	lanes: persisted('status-rail-lanes', true),
	feeds: persisted('status-rail-feeds', true),
};

function setRailOpen(key: keyof typeof railOpen, next: boolean): void {
	railOpen[key].value = next;
}
```

Wrap each applicable rail summary in `CollapsibleSection`, bind both responsive mounts to the same value, and pass both global signals. Keep Lanes absent when `laneStat.total === 0` and Feeds absent when `feedStat.total === 0`. Use stack/definition-row layouts rather than forcing a grid.

- [ ] **Step 7: Implement open-then-scroll navigation and pending async hashes**

Use one decoder and one reveal path for initial hash, `hashchange`, desktop ToC, and mobile ToC:

```ts
let pendingHash = $state<string | null>(null);

function decodedHash(): string | null {
	const raw = window.location.hash.replace(/^#/, '');
	if (!raw) return null;
	try {
		return decodeURIComponent(raw);
	} catch {
		return null;
	}
}

async function reveal(id: string): Promise<boolean> {
	if (!openableAnchors.has(id)) return false;
	openCard(id);
	await tick();
	tocElement(id)?.scrollIntoView({
		behavior: prefersReducedMotion.current ? 'auto' : 'smooth',
		block: 'start',
	});
	return true;
}

async function consumePendingHash(): Promise<void> {
	const id = pendingHash;
	if (!id || !openableAnchors.has(id)) return;
	await tick();
	if (await reveal(id)) pendingHash = null;
}
```

Set `pendingHash` on mount and `hashchange`. Add an effect that reads the current ordered ToC ids and calls `consumePendingHash()` when a target becomes present. Once null, later data refreshes cannot scroll it again. `navigate(id)` calls `reveal(id)` directly. Keep malformed hashes harmless.

Define the available async targets directly from the current presence registry:

```ts
const openableAnchors = $derived(new Set(tocEntries.map((entry) => entry.id)));
```

In the async test, import `dataRefresh`, make subsequent mocked fetches resolve the same fixtures, and call `dataRefresh.bumpEpoch()` to prove a later resource refresh cannot consume the same hash twice.

- [ ] **Step 8: Reconnect DetailShell observation when conditional targets change**

Replace the one-time `onMount` observer with a client effect keyed by the ordered ToC id signature and delayed until the DOM update settles:

```ts
import { tick } from 'svelte';

$effect(() => {
	const signature = tocEntries.map((entry) => entry.id).join('|');
	let cancelled = false;
	let stop: (() => void) | undefined;

	void (async () => {
		void signature;
		await tick();
		if (!cancelled) stop = observeActiveToc((id) => (activeId = id));
	})();

	return () => {
		cancelled = true;
		stop?.();
	};
});
```

Do not alter the DetailShell grid, breakpoint, hazard tape, or mobile-summary placement.

- [ ] **Step 9: Run focused tests and verify GREEN**

Run:

```bash
cd apps/web && bunx vitest run \
  src/lib/components/shared/QuietModeButton.svelte.test.ts \
  src/lib/components/shared/CollapsibleSection.test.ts \
  src/lib/components/layout/DetailShell.svelte.test.ts \
  src/lib/components/shared/toc.test.ts \
  src/lib/features/metrics/MetricsExplainer.svelte.test.ts \
  src/lib/features/health/HealthStatus.svelte.test.ts \
  src/lib/features/health/HealthStatus.async.svelte.test.ts
```

Expected: all focused tests PASS, including independent resource failures, responsive rail synchronization, remembered collapse, and async hash precedence.

- [ ] **Step 10: Run the full pre-commit gate and commit**

Run the Global Constraints pre-commit battery, then:

```bash
git add apps/web/src/lib/features/health/HealthStatus.svelte \
  apps/web/src/lib/features/health/HealthStatus.svelte.test.ts \
  apps/web/src/lib/features/health/HealthStatus.async.svelte.test.ts \
  apps/web/src/lib/features/health/health.copy.ts \
  apps/web/src/lib/components/layout/DetailShell.svelte \
  apps/web/src/lib/components/layout/DetailShell.svelte.test.ts
git commit -m "feat(web): complete status collapsible article"
```

---

### Task 5: Verify source parity and prepare the operator visual pass

**Files:**

- Inspect only: exact yesid.dev reference components and pages.
- Inspect only: Transit `/metrics`, `/fr/metrics`, `/status`, `/fr/status`.
- Modify only if a new failing regression test proves a defect.

**Interfaces:**

- Consumes: Tasks 1 through 4.
- Produces: a clean verification record, same-viewport reference/implementation comparison images, local review URLs, and a precise operator checklist.

- [ ] **Step 1: Run the full gate battery from a clean worktree**

Run the Global Constraints pre-commit battery once more. Then run:

```bash
git status --short
git diff --check
```

Expected: no uncommitted tracked changes and every gate green. Ignored `.superpowers/sdd/*` reports may remain.

- [ ] **Step 2: Confirm the local dev server and chosen Chrome session**

Use the existing dev server when healthy; otherwise start it without changing ports unexpectedly:

```bash
curl -fsS http://localhost:5174/metrics >/dev/null
curl -fsS http://localhost:5174/status >/dev/null
```

Use Chrome/CDP only. Do not introduce Playwright or another browser.

- [ ] **Step 3: Capture the complete visual matrix**

Capture reference and Transit at matching viewport, theme, locale, and state. At minimum:

- 1512 px desktop and 390 px mobile for `/metrics`, `/fr/metrics`, `/status`, `/fr/status`.
- Light and dark themes.
- Default open, bulk collapsed, remembered collapsed, and manually reopened card states.
- 320, 390, and 430 px French overflow checks.
- Long SQL, metric caveats, status rows, resource error/empty notices, and right-rail/mobile-summary cards.
- Direct hashes while remembered collapse is active.

Place each yesid.dev reference screenshot beside its matching Transit screenshot in one comparison image before judging. Inspect padding, margins, font size, font weight, borders, radii, clipping, control wrapping, focus states, and card state continuity.

- [ ] **Step 4: Fix only evidence-backed visual defects with TDD**

For every defect, first add a focused failing DOM/source test, verify RED, implement the smallest fix, verify GREEN, rerun the relevant paired Chrome comparison, then rerun the full pre-commit gate before committing.

Use commit form:

```bash
git commit -m "fix(web): tighten collapsible article parity"
```

Skip this step when no defect exists.

- [ ] **Step 5: Hand the operator the local review URLs and checklist**

Provide:

- `http://localhost:5174/metrics`
- `http://localhost:5174/fr/metrics`
- `http://localhost:5174/status`
- `http://localhost:5174/fr/status`

Ask the operator to review typography, exact control wording, independent card toggles, bulk/remember behavior, desktop/mobile rail continuity, long French wrapping, loading/error/absence states, and direct hashes. State explicitly that nothing has been pushed and no pull request exists. Stop there until the operator approves publication.
