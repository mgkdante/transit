# Home

`home.copy.ts` owns the eleven destinations, their question and answer-kind groups, and EN/FR copy. `HomeExplore.svelte` renders that directory without a home-specific data request or polling store.

The unfiltered view highlights Network health and Network map, then lists the other nine destinations. Each URL appears once. A question and an answer kind intersect across all eleven destinations; filtering never excludes a link because it was featured.

Mobile filters use one native disclosure in normal page flow. Escape returns focus to its summary. Crossing the desktop breakpoint preserves access to the focused controls. Empty results include a direct clear action.

The route tests in `src/routes/[[lang=locale]]/page.svelte.test.ts` cover localized URLs, grouping, intersections, empty recovery, keyboard controls, and server rendering. Browser acceptance also checks the disclosure with touch, responsive focus, themes, and reduced motion.
