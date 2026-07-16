import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const BASE_TEXT_VOCABULARY = [
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
] as const;

const BASE_COLOR_VOCABULARY = [
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
] as const;

export function createTwMergeConfig(vocab?: { text?: string[]; colors?: string[] }) {
	return {
		extend: {
			theme: {
				text: [...BASE_TEXT_VOCABULARY, ...(vocab?.text ?? [])],
				color: [...BASE_COLOR_VOCABULARY, ...(vocab?.colors ?? [])],
			},
		},
	} as const;
}

/**
 * Creates a class-name merger for products that share the base brand vocabulary.
 * A third consumer passes only its extra text and color tokens; product-specific
 * vocabulary stays in that consumer's preset so this factory remains identical
 * everywhere it is used.
 */
export function createCn(vocab?: { text?: string[]; colors?: string[] }) {
	const twMerge = extendTailwindMerge(createTwMergeConfig(vocab));

	return (...inputs: ClassValue[]) => twMerge(clsx(inputs));
}
