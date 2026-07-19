import type { ClassValue } from 'clsx';
import { createCn, createTwMergeConfig } from './create-cn.js';

export type UiVocabulary = {
	text?: readonly string[];
	colors?: readonly string[];
};

export type UiConfiguration = {
	vocab?: UiVocabulary;
};

export type ConfigureUiResult = 'initialized' | 'unchanged';

type NormalizedUiConfiguration = {
	vocab: {
		text: readonly string[];
		colors: readonly string[];
	};
};

function normalizeVocabulary(
	values: readonly string[] | undefined,
	field: 'vocab.text' | 'vocab.colors',
) {
	if (values === undefined) return [];
	if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
		throw new TypeError(`@yesid/ui configureUi() ${field} must be an array of strings.`);
	}
	return [...new Set(values)].sort();
}

function normalizeConfiguration({ vocab }: UiConfiguration = {}): NormalizedUiConfiguration {
	return {
		vocab: {
			text: normalizeVocabulary(vocab?.text, 'vocab.text'),
			colors: normalizeVocabulary(vocab?.colors, 'vocab.colors'),
		},
	};
}

function hasSameValues(left: readonly string[], right: readonly string[]) {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function conflictingFields(
	current: NormalizedUiConfiguration,
	incoming: NormalizedUiConfiguration,
) {
	const fields: string[] = [];
	if (!hasSameValues(current.vocab.text, incoming.vocab.text)) fields.push('vocab.text');
	if (!hasSameValues(current.vocab.colors, incoming.vocab.colors)) fields.push('vocab.colors');
	return fields;
}

const DEFAULT_CONFIGURATION = normalizeConfiguration();

let mergeClasses = createCn();
let activeConfiguration: NormalizedUiConfiguration | undefined;

export const twMergeConfig = createTwMergeConfig();

export function configureUi(configuration: UiConfiguration = {}): ConfigureUiResult {
	const incoming = normalizeConfiguration(configuration);

	if (activeConfiguration) {
		const fields = conflictingFields(activeConfiguration, incoming);
		if (fields.length === 0) return 'unchanged';

		throw new Error(
			`@yesid/ui is already initialized with a different configuration. Conflicting fields: ${fields.join(', ')}. configureUi() accepts one semantic configuration per loaded ESM module instance.`,
		);
	}

	const candidateMergeClasses = createCn({
		text: [...incoming.vocab.text],
		colors: [...incoming.vocab.colors],
	});
	candidateMergeClasses();
	activeConfiguration = incoming;
	mergeClasses = candidateMergeClasses;
	return 'initialized';
}

export function cn(...inputs: ClassValue[]) {
	activeConfiguration ??= DEFAULT_CONFIGURATION;
	return mergeClasses(...inputs);
}

export { createCn, createTwMergeConfig };

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
