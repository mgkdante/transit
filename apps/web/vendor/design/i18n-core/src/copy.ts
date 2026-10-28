/** The shape a copy entry must keep in every other locale: same keys and signatures, strings widened. */
export type CopyShape<Value> = Value extends (...args: infer Args) => infer Result
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

/** One copy object per locale; the `Source` locale's object sets the shape the others must match. */
export type LocalizedCopy<Canonical extends object, Locale extends string, Source extends Locale> = {
	readonly [Key in Locale]: Key extends Source ? Canonical : CopyShape<NoInfer<Canonical>>;
};

export type DefineCopy<Locale extends string, Source extends Locale> = <Canonical extends object>(
	copy: LocalizedCopy<Canonical, Locale, Source>,
) => Readonly<Record<Locale, CopyShape<Canonical>>>;

/**
 * Returns the app's `defineCopy`: it checks at compile time that every locale has the source
 * locale's keys and signatures, and returns the copy unchanged.
 */
export function createCopy<Locale extends string, Source extends Locale>(): DefineCopy<Locale, Source> {
	return <Canonical extends object>(copy: LocalizedCopy<Canonical, Locale, Source>) =>
		copy as Readonly<Record<Locale, CopyShape<Canonical>>>;
}
