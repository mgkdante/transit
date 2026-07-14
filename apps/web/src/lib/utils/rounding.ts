const MAX_FRACTION_DIGITS = 100;

/** Round the decimal spelling of a number, with exact ties moving away from zero. */
export function roundHalfAwayFromZero(value: number, digits: number): number {
	if (!Number.isFinite(value)) return value;
	if (!Number.isInteger(digits) || digits < 0 || digits > MAX_FRACTION_DIGITS) {
		throw new RangeError(`digits must be an integer between 0 and ${MAX_FRACTION_DIGITS}`);
	}

	const [mantissa, exponentText] = Math.abs(value).toString().toLowerCase().split('e');
	const [whole, fraction = ''] = mantissa.split('.');
	const coefficient = BigInt(`${whole}${fraction}`);
	const sourceScale = fraction.length - Number(exponentText ?? 0);
	const scaleShift = digits - sourceScale;

	let roundedUnits: bigint;
	if (scaleShift >= 0) {
		roundedUnits = coefficient * 10n ** BigInt(scaleShift);
	} else {
		const divisor = 10n ** BigInt(-scaleShift);
		roundedUnits = coefficient / divisor;
		if ((coefficient % divisor) * 2n >= divisor) roundedUnits += 1n;
	}

	const negative = value < 0;
	let decimal = roundedUnits.toString();
	if (digits > 0) {
		decimal = decimal.padStart(digits + 1, '0');
		decimal = `${decimal.slice(0, -digits)}.${decimal.slice(-digits)}`;
	}
	const result = Number(`${negative ? '-' : ''}${decimal}`);
	return Object.is(result, -0) ? 0 : result;
}
