// Barrel for `$lib/utils`. Re-exports the class-name merge util + tw-merge
// config, the shared component type helpers, and the America/Toronto time
// formatters. Import from `$lib/utils` rather than the individual modules.

export { cn, twMergeConfig } from './cn';
export type { WithoutChild, WithoutChildren, WithoutChildrenOrChild, WithElementRef } from './cn';

export {
	DISPLAY_TIME_ZONE,
	ageSeconds,
	formatClock,
	formatDateKey,
	formatRelative,
	formatRelativeSeconds,
	formatUtc,
	providerLocalDateKey,
} from './time';
export type { TimeLang } from './time';

export { fmtCount, fmtDelayMin, fmtPct } from './format';
export type { FormatLang } from './format';

export { roundHalfAwayFromZero } from './rounding';
