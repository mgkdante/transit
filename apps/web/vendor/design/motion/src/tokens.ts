// GENERATED FROM packages/tokens/tokens.json — DO NOT EDIT
// Mirror of motion tokens for JS consumers (GSAP, Svelte actions) that need
// these values at compute time without paying for getComputedStyle().
// Repository artifact tests keep this in sync with the package-owned CSS.
// Run `bun run tokens:build` to regenerate.

export const duration = {
	instant: 100,
	fast: 150,
	normal: 200,
	slow: 300,
	slower: 500,
} as const;

export const ease = {
	default: 'cubic-bezier(0.4, 0, 0.2, 1)',
	out: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
	inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
	bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

export type DurationKey = keyof typeof duration;
export type EaseKey = keyof typeof ease;

// Convenience: duration in seconds (GSAP uses seconds, not ms).
export function durationSec(key: DurationKey): number {
	return duration[key] / 1000;
}
