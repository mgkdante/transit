export { cn } from '$lib/ui/configure';
export type {
	WithoutChild,
	WithoutChildren,
	WithoutChildrenOrChild,
	WithElementRef,
} from '@yesid/ui/cn';

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

export { fmtNumber, fmtCount, fmtDelayMin, fmtPct } from './format';
export type { FormatLang } from './format';

export { roundHalfAwayFromZero } from './rounding';
