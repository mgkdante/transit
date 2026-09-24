import { createTwMergeConfig } from '@yesid/ui/cn';
import { TRANSIT_VOCAB } from './cn-vocab';

export { cn } from '$lib/ui/configure';

// tailwind-variants performs its own merge before cn() runs, so its consumers
// need the same vocabulary through their existing twMergeConfig import.
export const twMergeConfig = createTwMergeConfig(TRANSIT_VOCAB);

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
