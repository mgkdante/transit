# Metrics and Status Collapsible Article Design

Date: 2026-07-09
Status: Awaiting operator review
Scope: Transit `/metrics` and `/status` only

## Outcome

Make `/metrics` and `/status` read like the project and blog articles on yesid.dev while preserving Transit content and data honesty. Both pages use the new article header, the exact two yesid.dev page controls, and a clear collapsible-card anatomy across the left rail, center column, and right rail.

The result should let a reader close everything, reopen everything, remember a collapsed starting state, and then open only the cards they need. Text remains comfortable to read in every state and at every supported viewport.

## Source of truth

The implementation must match these live code patterns rather than invent a new interaction:

- yesid.dev `QuietModeButton.svelte` for the two buttons, copy, state changes, icons, and accessible naming.
- yesid.dev blog and project detail pages for collapsible left-rail, article-section, and right-rail cards.
- Transit `ArticleHeader.svelte`, `DetailShell.svelte`, `CollapsibleSection.svelte`, `TocNav.svelte`, typography tokens, and brand tokens for the local rendering.

Transit may adapt content structure to fit metrics and operational status data. It must not rename the controls or replace their behavior.

## In scope

- `/metrics` and `/fr/metrics`.
- `/status` and `/fr/status`.
- Exact yesid.dev two-control behavior in each article header.
- A collapsible card for every logical content block in all three page columns.
- Content-specific organization inside each card.
- Deep-link, keyboard, responsive, reduced-motion, loading, error, and honest-absence behavior.
- Chrome visual verification on the local dev server before any push or pull request.

## Out of scope

- Homepage, maps, search, listings, and other analytical pages.
- A site-wide analytical-page retrofit in this pass.
- Transit scroll journeys.
- Vertical edge titles.
- Text glow.
- New metrics, fabricated status detail, or changes to the snapshot contract.
- Push, pull request, merge, or deployment before the operator completes the requested visual pass and explicitly approves publication.

## Exact header controls

Each page header contains exactly two section controls, in the same order and with the same visible wording as yesid.dev.

| Bulk mode | English | French | Action |
| --- | --- | --- | --- |
| Page is expanded | `Collapse all` | `Tout replier` | Closes every participating card in the left, center, and right columns. |
| Page is collapsed | `Expand all` | `Tout déplier` | Opens every participating card in the left, center, and right columns. |
| Collapsed start is not saved | `Always start collapsed` | `Toujours replier` | Closes the page and saves collapsed as the default for future article visits. |
| Collapsed start is saved | `Don't start collapsed` | `Ne plus replier` | Stops saving the collapsed default without changing the cards currently on screen. |

The controls are plain buttons. Their visible, state-dependent verb is their accessible name. They do not use `role="switch"` or `aria-pressed`, because those states would duplicate the action already announced by the label. The first button keeps the yesid.dev broadcast-arcs/core icon and `data-collapsed` state. The second keeps the yesid.dev bookmark icon, not the current Transit pushpin, and its `data-remembered` state. Their 44 px minimum targets, two-pixel brand border, spacing, control-size mono text, hover, focus, and active treatment match the source. The control row must contain no third expand/collapse button.

The title text may explain the result in a longer sentence, matching the yesid.dev source:

- `Collapse all sections on this page` / `Replier toutes les sections de la page`.
- `Expand all sections on this page` / `Déplier toutes les sections de la page`.

## State model

1. In a fresh session with no remembered preference or card-level state, all participating cards start open.
2. `Collapse all` closes the left ToC card, all center cards, and every visible right-rail card.
3. The same control then reads `Expand all`; activating it opens all participating cards.
4. `Always start collapsed` immediately closes all cards and persists one site-level collapsed preference under the existing Transit storage key.
5. `Don't start collapsed` removes that preference but leaves the current page unchanged.
6. A reader may independently open or close any card after either bulk action.
7. An individual card toggle does not rewrite the bulk-mode label. The first button reflects the yesid.dev quiet-mode state, not a computed count of currently open cards.
8. Unsaved bulk mode lasts only for the current mounted article. Mounting a new article control reinitializes from the stored preference exactly like yesid.dev: stored `true` collapses the new article; no stored preference resets bulk mode to expanded and sends the open signal to its cards.
9. The remembered preference is shared, as it is on yesid.dev, but only `/metrics` and `/status` consume it in this pass.
10. Card-level session keys remain stable and locale-independent so an EN/FR navigation does not reset the reader's current layout, except that the page-level remembered or reset bulk signal remains authoritative on mount.
11. A direct hash or ToC selection opens its target card before scrolling. It works even when the remembered default has collapsed everything.
12. A card that is not rendered because its source data is absent does not participate in the bulk state. The page does not create empty shells to make the layout look fuller.

## Shared card anatomy

All participating cards use Transit `CollapsibleSection`, which already ports the yesid.dev article card grammar:

- 3 px article-card border.
- Heading at the shared article section size, `1.125rem`, heading font, weight 700.
- Optional one-line subtitle remains visible while collapsed when it helps identify the content.
- 24 px horizontal body padding at regular widths, reduced only through the shared responsive rules.
- Source chevron and clear hover/focus treatment.
- One semantic disclosure button per card with `aria-expanded` and keyboard support.
- The non-interactive card surface may also toggle the card. Links, buttons, form fields, nested cards, and text selection must keep their own behavior and must not toggle an ancestor.

Body copy follows the exact yesid.dev project and blog article scale: `1.0625rem` on smaller viewports and `1.125rem` from the desktop article breakpoint, with narrative line heights of `1.8` and `1.9` respectively. Transit may express those values through shared tokens, but the rendered sizes must match. Dense structured rows and code may retain their purpose-built scale; full explanatory prose may not be reduced to a caption. Compact right-rail explanations use the source rail scale, `0.95rem` with a `1.45` line height, but never caption-sized prose for material information.

The design must not force every card into the same grid:

- Explanatory writing uses a vertical prose stack.
- Label/value facts use a definition-list or key/value stack.
- Counts use a strong value followed by a plain-language label.
- Closely related metrics may use two columns only when the card width supports it.
- Status lists, caveats, and source lineage use rows or lists with clear separators.
- Tags and confidence levels use wrapping chips.
- Code remains in the existing code block.
- Every multi-column body becomes one column before text or controls feel cramped.

## `/metrics` anatomy

### Left rail

The existing table of contents remains one collapsible `TocNav` card. Its own chevron and persisted manual state remain available. It also listens to the two header controls.

### Center column

No lede or explanatory block floats outside a card.

1. **Method and provenance card**: contains the page lede, provenance statement, live conformance badge or honest stand-down, service-day explanation, rounding explanation, live doctrine constants or their absence message, and the confidence legend. This replaces the current loose lede and unframed provenance section with one readable opening card.
2. **Metric cards**: one existing numbered card per metric. Definition, math, SQL, limitations, caveats, and the optional current-pipeline note remain distinct stacked subsections inside the card.
3. **Live vehicle positions card**: keeps its plain-language lede and ordered explanatory points in a vertical reading flow.
4. **Structural gaps card**: keeps the honest limitations as a readable list with a heading and explanation for each gap.

The current cluster labels may continue to group metric cards visually, but a label cannot become loose article content that looks like an uncollapsible section. It is a small grouping marker only.

The current separate metrics expand/collapse button is removed. The shared two-button control is the only bulk-control surface.

### Right rail and mobile summary

Each visible summary is its own collapsible card with a stable key:

1. **Provenance**: conformance verdict or the existing honest unavailable message.
2. **Coverage**: metric count, family count, and wrapping confidence chips. Counts may use a compact two-column treatment when space permits.
3. **Freshness**: generated timestamp using the existing freshness component.

On desktop these cards stack in the sticky right rail. On smaller screens the same cards appear in normal page flow above the center content. They remain individual disclosures in both placements.

Responsive rendering must preserve one logical open state per card. If the shell needs separate desktop and mobile mounts, both mounts bind to the same page-owned state; resizing the viewport cannot resurrect an older hidden instance state.

## `/status` anatomy

### Left rail

The existing conditional table of contents remains one collapsible `TocNav` card and listens to both bulk signals. It renders only when there are section targets to navigate to.

### Center column

1. **Overview / Vue d’ensemble card**: always contains the page lede. When available, it also contains the aggregate lane-gate verdict so the primary answer is not split into a separate terminal shell before the article begins. During data loading or failure, the page keeps an honest readable boundary rather than pretending that a verdict exists. This is an unnumbered opening card and is not a ToC entry; the existing pipeline sections keep numbers 1 through 8.
2. **Pipeline lanes card**.
3. **Feed freshness card**.
4. **Source lineage card**.
5. **Known data gaps card**.
6. **Pipeline notes card**.
7. **Retention card**.
8. **Conformance card**.
9. **Build accountability card**.

Each data-backed card renders only when its current presence condition is true. The existing fixed section order and ToC numbering remain stable.

Each top-level status section becomes the card itself. Its current `SectionHeading` is removed or converted to body-only content so there is one visible title, not a card title followed by a duplicate title. Specialized inner structure remains where useful:

- Pipeline rows may retain the diagnostic terminal treatment inside the card.
- Conformance may retain the meaningful nested `Unmodelled fields` disclosure.
- Freshness, sources, gaps, notes, retention, and envelope content keep the layout best suited to their data.

### Right rail and mobile summary

Each available summary becomes its own collapsible card:

1. **Lanes**: passing count plus worst lane or all-clear copy.
2. **Feeds**: fresh-feed count.

They stack in the desktop rail and appear in normal mobile page flow. If either summary has no applicable data, it stands down instead of rendering an empty card.

Responsive rendering must preserve one logical open state per card. A manual toggle before or after a breakpoint change must not reveal a stale duplicate instance.

## Navigation and deep links

- Every navigable center card has a stable locale-free anchor and card key. The unnumbered Status Overview card has a stable card key but is intentionally outside the ToC.
- ToC navigation opens the destination, waits for the disclosure state to settle, then scrolls it below the sticky chrome.
- Direct loads such as `/metrics#live-positions` and status section hashes open the destination before final positioning.
- A conditional status hash remains pending while its source is loading. When the relevant `tocEntries` target first appears, the page opens and scrolls that card, then consumes the pending hash so later data refreshes do not pull the reader back.
- Reduced-motion users get immediate scrolling and state changes without smooth-scroll or disclosure animation dependencies.
- Closing a currently active card does not remove its ToC entry or make the page lose the anchor.

## Responsive behavior

- At the existing `DetailShell` desktop breakpoint, use left ToC, center article, and right summary rail.
- Below that breakpoint, the floating ToC control owns navigation and the right-rail cards move into normal flow.
- The header controls wrap cleanly without shrinking their 44 px targets.
- Card titles, subtitles, chips, code blocks, timestamps, and long French labels must not clip or overflow at 320, 390, and 430 px.
- Any two-column card body becomes one column when the available card width is too narrow.
- Collapsing a card must remove its body from layout without leaving large decorative gaps.

## Accessibility and legibility acceptance

- Exactly one page `h1`; card headings follow a valid document order.
- Every disclosure has a keyboard-operable button and accurate `aria-expanded` state.
- The exact visible action label is the bulk button's accessible name.
- Icons are decorative and hidden from assistive technology.
- Focus rings remain visible in light and dark themes.
- No meaningful status is communicated by color alone.
- Body prose, subtitles, labels, counts, timestamps, code, and error messages pass the existing Transit contrast and typography checks.
- English and French content are both reviewed. French cannot be treated as a spacing afterthought.

## Loading, error, and honest absence

- Existing resource boundaries continue to own loading and error presentation. Their visible loading or error message sits inside the relevant overview or content card rather than becoming loose, uncollapsible page content.
- Status treats its daily provenance document and live data-health document independently:
  - While both load, Overview keeps the lede and shows two clearly labelled loading regions.
  - If daily provenance fails or is absent while live data health resolves, Overview shows the daily-record error or empty state, while the aggregate verdict, Pipeline lanes card, and Lanes rail card may still render from live data.
  - If live data health fails or is absent while daily provenance resolves, Overview shows the live-feed error or empty state, while provenance-backed center cards and the Feeds rail card may still render.
  - When both resolve, Overview shows the aggregate verdict only when applicable lanes exist; downstream cards still follow their current slice-presence conditions.
  - A failure in one resource never hides valid cards from the other resource.
- A missing live source produces the existing localized stand-down copy, not a blank region, stale invented value, or reassuring guess.
- Static methodology remains available when optional live provenance is unavailable.
- Status cards derive from the same resolved data as their ToC and right-rail summaries so the three surfaces cannot disagree about what exists.
- Expanding or collapsing never refetches data and never changes the underlying verdict.

## Test-first implementation requirements

Before behavior code changes, add or update focused tests that fail for the intended reasons:

1. Exact EN and FR button labels in all four states.
2. Source icons and `data-collapsed` / `data-remembered` state hooks, no `role="switch"`, no `aria-pressed`, and no third metrics bulk-control button.
3. Both buttons control every rendered left, center, and right card on `/metrics` and `/status`.
4. Default-open, remembered-collapsed, forget-without-opening, and independent manual card behavior.
5. Direct hashes and ToC navigation open a collapsed destination before scrolling.
6. Every metrics and status logical block is inside its expected card.
7. Status top-level cards do not repeat their section heading.
8. Conditional status and right-rail cards stand down when data is absent.
9. EN/FR and reduced-motion behavior.
10. Mobile layout assertions for controls and summary-card flow, plus a breakpoint-change test proving a manually changed rail-card state does not revert through a hidden duplicate instance.
11. Independent Status resource states for both loading, either source failing or empty, and both ready.
12. A status hash that targets an async conditional card is consumed only after that card appears, opens, and receives the scroll.

After focused tests pass, run the complete repository gate battery required by the Transit project before any commit that claims implementation is complete.

## Chrome visual review gate

Use the existing local dev server and the user's chosen Chrome workflow. Compare the Transit build against the yesid.dev project/blog article source at the same viewport and state. Screenshots alone are not sufficient; reference and implementation must be judged together.

The operator review handoff must provide local URLs and ask for these checks:

1. `/metrics` and `/fr/metrics`, desktop and mobile.
2. `/status` and `/fr/status`, desktop and mobile.
3. Light and dark themes.
4. Both buttons in normal, collapsed, remembered, and forgotten states.
5. Independent left, center, and right card toggles.
6. Long metric content, code blocks, status rows, missing-data messages, and French wrapping.
7. Direct hash navigation while everything starts collapsed.
8. 320, 390, 430, and a normal desktop width for clipping and readable text.

No push or pull request occurs until the operator reports that this visual pass is complete and explicitly approves the next publication step.

## Later decision

After the operator reviews `/metrics` and `/status`, the same article-header and collapsible-card system can be evaluated page by page for other analytical surfaces. That is a new design decision, not an automatic consequence of this implementation. Homepage and maps remain excluded.
