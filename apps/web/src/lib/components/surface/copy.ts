// SurfaceHeadCopy — the shared shape of a surface's head block (the kicker /
// heading / optional subheading / lede triple that Masthead renders).
//
// Each surface copy module's interface `extends SurfaceHeadCopy` so the head
// fields are declared ONCE instead of re-typed per surface. slice-9.4's copy
// file does the same, and its head wires into Masthead with no new types.

export interface SurfaceHeadCopy {
	/** Mono station-voice overline (e.g. "NETWORK · LIVE"). */
	readonly kicker: string;
	/** Display heading. */
	readonly heading: string;
	/** Optional mono subheading under the heading (e.g. "// SEARCH"). */
	readonly subheading?: string;
	/** Optional muted lede paragraph (~52ch). */
	readonly lede?: string;
}
