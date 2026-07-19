// wordmarkHover — P5.1 (2026-07-02): the local port (vendored from yesid.dev
// pre-turborepo) is RETIRED in favor of the design-system copy
// (@yesid/motion, vendored at vendor/design/motion and pinned by
// the schema-2 adoption manifest). The signature brand interaction now ships from ONE
// place. Behavior-identical swap, verified against the old port:
//   - durationSec() token values == the old literals (slow .3 / fast .15 /
//     slower .5; the .25 effectWave literal is unchanged upstream),
//   - PRM/touch/SSR guards are the same set (package reads its own
//     reducedMotion store — same prefers-reduced-motion media query as
//     $lib/motion/reduced-motion.svelte),
//   - initScrollTriggerConfig() is inert here (transit has no ScrollTrigger
//     scenes; registration is idempotent).
// Import path preserved so consumers ($lib/motion/actions) are untouched.
export { wordmarkHover, type WordmarkHoverParams } from '@yesid/motion/actions';
