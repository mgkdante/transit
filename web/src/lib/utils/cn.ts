import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge our @theme vocabulary. Without this, brand font-size
// utilities (text-body, text-caption, ...) are unknown to tw-merge, which
// classifies them as text COLORS — any real text color earlier in the list
// gets merged away. Worse here: the dataviz color names (text-dataviz-status-late,
// bg-dataviz-heatmap-3, ...) would otherwise be misread as font-sizes, so a data
// mark's color could be silently dropped. We enumerate the FULL color + text
// vocabulary so both axes resolve correctly.
//
// `theme.text` = font-size scale (--text-*); `theme.color` = color names
// (--color-*) — mirrors src/app.css @theme. The color suffixes here are the bare
// token names (everything after `--color-`), e.g. `--color-dataviz-status-on-time`
// → "dataviz-status-on-time".
//
// Exported so tv() consumers (tailwind-variants runs its OWN internal merge
// before cn() ever sees the classes) can pass the same vocabulary via
// { twMergeConfig }.
export const twMergeConfig = {
	extend: {
		theme: {
			text: [
				'hero',
				'hero-mobile',
				'display',
				'title',
				'heading',
				'subheading',
				'body',
				'small',
				'mono',
				'caption',
				'micro',
			],
			color: [
				// Brand / semantic surface + accent colors
				'signage-bg',
				'signage-text',
				'accent-text',
				'accent-hover',
				'primary-hover',
				'terminal',
				'manifesto',
				'success',
				'border-subtle',
				'border-strong',
				// Dataviz: status scale
				'dataviz-status-early',
				'dataviz-status-on-time',
				'dataviz-status-late',
				'dataviz-status-severe',
				'dataviz-status-unknown',
				// Dataviz: occupancy scale
				'dataviz-occupancy-empty',
				'dataviz-occupancy-many-seats',
				'dataviz-occupancy-few-seats',
				'dataviz-occupancy-standing',
				'dataviz-occupancy-full',
				// Dataviz: severity scale
				'dataviz-severity-critical',
				'dataviz-severity-high',
				'dataviz-severity-watch',
				// Dataviz: heatmap ramp
				'dataviz-heatmap-0',
				'dataviz-heatmap-1',
				'dataviz-heatmap-2',
				'dataviz-heatmap-3',
				'dataviz-heatmap-4',
				'dataviz-heatmap-nodata',
				// Dataviz: vehicle scale
				'dataviz-vehicle-on-time',
				'dataviz-vehicle-delayed',
				'dataviz-vehicle-cancelled',
				'dataviz-vehicle-no-data',
			],
		},
	},
} as const;

const twMerge = extendTailwindMerge(twMergeConfig);

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
