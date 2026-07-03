// yesid.dev preset tables — transcribed verbatim from the source gates at the
// parity anchor (yesid.dev @ 2bdb611d): style-regressions.test.ts FORBIDDEN
// table, contrast-floors.test.ts Engine-A config + the 57 computed AA pairs +
// the 2 terminal identities. When yesid.dev flips to this package, its thin
// gate specs consume these tables and stay behavior-identical.
import type { ForbiddenPattern } from '../engines/styleRegressions.js';
import type { ContrastPair, TokenIdentity } from '../engines/contrastPairs.js';

export const YESID_FORBIDDEN: readonly ForbiddenPattern[] = [
	{ pattern: /\bbg-bg-/, reason: 'bg-bg-* is not a token utility (use bg-background / bg-card)' },
	{ pattern: /\bborder-bg-/, reason: 'border-bg-* is not a token utility (use border-border-subtle)' },
	{ pattern: /\btext-text-/, reason: 'text-text-* is not a token utility (use text-secondary-foreground)' },
	{ pattern: /var\(--text-light\)/, reason: '--text-light is undefined (use var(--secondary-foreground))' },
	{ pattern: /var\(--dim-foreground\)|var\(--light-foreground\)/, reason: 'aliases to undefined vars (archived in app.css)' },
];

/** Engine-A file list + marker allowlist (relative to the app root). */
export const YESID_COLOR_MIX_FILES: readonly string[] = [
	'src/lib/components/home/Manifesto.svelte',
	'src/lib/components/layout/MenuOverlay.svelte',
	'src/lib/components/home/FeaturedProjects.svelte',
	'src/lib/components/blog/BlogDetailHeader.svelte',
	'src/lib/components/projects/ProjectDetailHeader.svelte',
	'src/lib/components/shared/TocPill.svelte',
];

export const YESID_MARKER_ALLOWED_FILES: ReadonlySet<string> = new Set([
	'src/lib/components/projects/ProjectDetailHeader.svelte',
	'src/lib/components/blog/BlogDetailHeader.svelte',
]);

/** GO2-W5 computed AA pairs (57 at the anchor). */
export const YESID_AA_PAIRS: readonly ContrastPair[] = [
	// dark text pairs (AA 4.5)
	['D foreground/background', ['dark', 'foreground'], ['dark', 'background'], 4.5],
	['D foreground/card', ['dark', 'foreground'], ['dark', 'card'], 4.5],
	['D muted-foreground/popover (worst case)', ['dark', 'muted-foreground'], ['dark', 'popover'], 4.5],
	['D secondary-foreground/card', ['dark', 'secondary-foreground'], ['dark', 'card'], 4.5],
	['D secondary-foreground/terminal-chrome', ['dark', 'secondary-foreground'], ['dark', 'terminal-chrome'], 4.5],
	['D primary/popover (worst case)', ['dark', 'primary'], ['dark', 'popover'], 4.5],
	['D primary/card', ['dark', 'primary'], ['dark', 'card'], 4.5],
	['D primary/background (border-rule voice)', ['dark', 'primary'], ['dark', 'background'], 4.5],
	['D background-as-primary-foreground/primary', ['dark', 'background'], ['dark', 'primary'], 4.5],
	['D accent-text/card', ['dark', 'accent-text'], ['dark', 'card'], 4.5],
	['D accent-text/accent-surface', ['dark', 'accent-text'], ['dark', 'accent-surface'], 4.5],
	['D primary/accent-surface', ['dark', 'primary'], ['dark', 'accent-surface'], 4.5],
	['D accent-foreground/accent', ['dark', 'accent-foreground'], ['brand', 'accent'], 4.5],
	['D destructive-foreground/destructive', ['dark', 'destructive-foreground'], ['dark', 'destructive'], 4.5],
	['D destructive/card', ['dark', 'destructive'], ['dark', 'card'], 4.5],
	['D success/card', ['dark', 'success'], ['dark', 'card'], 4.5],
	['D terminal-ink/terminal', ['dark', 'terminal-ink'], ['dark', 'terminal'], 4.5],
	['D terminal-ink-muted/terminal', ['dark', 'terminal-ink-muted'], ['dark', 'terminal'], 4.5],
	['D terminal-ink-muted/terminal-chrome', ['dark', 'terminal-ink-muted'], ['dark', 'terminal-chrome'], 4.5],
	// dark UI/graphics (3:1)
	['D input/card (1.4.11)', ['dark', 'input'], ['dark', 'card'], 3],
	['D line-amber/background (graphics)', ['dark', 'line-amber'], ['dark', 'background'], 3],
	['D signal-lunar/card (graphics)', ['dark', 'signal-lunar'], ['dark', 'card'], 3],
	// light text pairs (AA 4.5)
	['L foreground/background', ['light', 'foreground'], ['light', 'background'], 4.5],
	['L foreground/card', ['light', 'foreground'], ['light', 'card'], 4.5],
	['L muted-foreground/muted (worst case)', ['light', 'muted-foreground'], ['light', 'muted'], 4.5],
	['L muted-foreground/background', ['light', 'muted-foreground'], ['light', 'background'], 4.5],
	['L secondary-foreground/terminal-chrome', ['light', 'secondary-foreground'], ['light', 'terminal-chrome'], 4.5],
	['L primary/muted (worst case)', ['light', 'primary'], ['light', 'muted'], 4.5],
	['L primary/background', ['light', 'primary'], ['light', 'background'], 4.5],
	['L primary/terminal', ['light', 'primary'], ['light', 'terminal'], 4.5],
	['L background-as-primary-foreground/primary', ['light', 'background'], ['light', 'primary'], 4.5],
	['L primary-hover/background', ['light', 'primary-hover'], ['light', 'background'], 4.5],
	['L accent-text/terminal-chrome (worst case)', ['light', 'accent-text'], ['light', 'terminal-chrome'], 4.5],
	['L accent-text/muted', ['light', 'accent-text'], ['light', 'muted'], 4.5],
	['L accent-text/accent-surface', ['light', 'accent-text'], ['light', 'accent-surface'], 4.5],
	['L primary/accent-surface', ['light', 'primary'], ['light', 'accent-surface'], 4.5],
	['L accent-foreground/accent', ['light', 'accent-foreground'], ['brand', 'accent'], 4.5],
	['L destructive-foreground/destructive', ['light', 'destructive-foreground'], ['light', 'destructive'], 4.5],
	['L destructive/muted (worst case)', ['light', 'destructive'], ['light', 'muted'], 4.5],
	['L success/muted (worst case)', ['light', 'success'], ['light', 'muted'], 4.5],
	['L terminal-ink/terminal', ['light', 'terminal-ink'], ['light', 'terminal'], 4.5],
	['L terminal-ink-muted/terminal', ['light', 'terminal-ink-muted'], ['light', 'terminal'], 4.5],
	['L terminal-ink-muted/terminal-chrome', ['light', 'terminal-ink-muted'], ['light', 'terminal-chrome'], 4.5],
	// light UI/graphics (3:1)
	['L input/background (1.4.11)', ['light', 'input'], ['light', 'background'], 3],
	['L line-amber/background (graphics)', ['light', 'line-amber'], ['light', 'background'], 3],
	['L line-amber/card (graphics)', ['light', 'line-amber'], ['light', 'card'], 3],
	['L signal-lunar/muted (graphics)', ['light', 'signal-lunar'], ['light', 'muted'], 3],
	['L border-strong/card (round-2 hard structure)', ['light', 'border-strong'], ['light', 'card'], 3],
	// theme-invariant signal systems
	['hazard stripe pair (tape)', ['brand', 'hazard-a'], ['brand', 'hazard-b'], 3],
	['signage chip (both modes)', ['brand', 'signage-text'], ['brand', 'signage-bg'], 4.5],
	// round 4 — four-color doctrine pairs
	['D accent-text/background (wayfinding overlines/markers/readouts)', ['dark', 'accent-text'], ['dark', 'background'], 4.5],
	['D accent-text/manifesto (arrival board)', ['dark', 'accent-text'], ['dark', 'manifesto'], 4.5],
	['L accent-text/background (wayfinding overlines/markers/readouts)', ['light', 'accent-text'], ['light', 'background'], 4.5],
	['L accent-text/card (metric callouts on cards)', ['light', 'accent-text'], ['light', 'card'], 4.5],
	['L accent-text/manifesto (arrival board)', ['light', 'accent-text'], ['light', 'manifesto'], 4.5],
	['reflective/signage-bg (white voice on the black family)', ['brand', 'reflective'], ['brand', 'signage-bg'], 4.5],
	['L border-strong/background (black tape structure, graphics)', ['light', 'border-strong'], ['light', 'background'], 3],
];

/** Taste round 2 operator contract: terminals are the SITE background. */
export const YESID_IDENTITIES: readonly TokenIdentity[] = [
	['terminal IS the site background (dark)', ['dark', 'terminal'], ['dark', 'background']],
	['terminal IS the site background (light)', ['light', 'terminal'], ['light', 'background']],
];
