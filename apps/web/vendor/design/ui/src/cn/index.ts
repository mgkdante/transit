import type { ClassValue } from 'clsx';
import { createCn, createTwMergeConfig } from './create-cn.js';

export type UiVocabulary = {
	text?: readonly string[];
	colors?: readonly string[];
};

export type UiConfiguration = {
	vocab?: UiVocabulary;
};

let mergeClasses = createCn();

export const twMergeConfig = createTwMergeConfig();

export function configureUi({ vocab }: UiConfiguration = {}) {
	mergeClasses = createCn({
		text: vocab?.text ? [...vocab.text] : undefined,
		colors: vocab?.colors ? [...vocab.colors] : undefined,
	});
}

export function cn(...inputs: ClassValue[]) {
	return mergeClasses(...inputs);
}

export { createCn, createTwMergeConfig };

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
