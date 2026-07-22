import type { Locale } from './config';

export type { Locale } from './config';

type CopyShape<Value> = Value extends (...args: infer Args) => infer Result
	? (...args: Args) => CopyShape<Result>
	: Value extends readonly unknown[]
		? number extends Value['length']
			? readonly CopyShape<Value[number]>[]
			: { readonly [Key in keyof Value]: CopyShape<Value[Key]> }
		: Value extends object
			? { readonly [Key in keyof Value]: CopyShape<Value[Key]> }
			: Value extends string
				? string
				: Value extends number
					? number
					: Value extends boolean
						? boolean
						: Value;

type LocalizedCopy<Canonical extends object> = {
	readonly fr: Canonical;
	readonly en: CopyShape<NoInfer<Canonical>>;
};

/**
 * Defines a bilingual bundle from the canonical French shape. English must
 * provide the same keys and function signatures; the returned contract is
 * deeply readonly without cloning or reordering the supplied object.
 */
export function defineCopy<Canonical extends object>(
	copy: LocalizedCopy<Canonical>,
): Readonly<Record<Locale, CopyShape<Canonical>>> {
	return copy as Readonly<Record<Locale, CopyShape<Canonical>>>;
}
