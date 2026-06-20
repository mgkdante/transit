import { describe, expect, it } from 'vitest';
import {
	otpVerdict,
	isProblemVerdict,
	OTP_ON_TIME_FLOOR,
	OTP_LATE_FLOOR,
} from './reliabilityVerdict';

describe('otpVerdict', () => {
	it('maps a strong OTP to on_time', () => {
		expect(otpVerdict(95)).toBe('on_time');
		expect(otpVerdict(OTP_ON_TIME_FLOOR)).toBe('on_time');
	});

	it('maps a slipping OTP to late', () => {
		expect(otpVerdict(82)).toBe('late');
		expect(otpVerdict(OTP_LATE_FLOOR)).toBe('late');
		expect(otpVerdict(OTP_ON_TIME_FLOOR - 1)).toBe('late');
	});

	it('maps a poor OTP to severe', () => {
		expect(otpVerdict(50)).toBe('severe');
		expect(otpVerdict(OTP_LATE_FLOOR - 1)).toBe('severe');
		expect(otpVerdict(0)).toBe('severe');
	});

	it('returns null for absent / NaN — never a fabricated verdict', () => {
		expect(otpVerdict(null)).toBeNull();
		expect(otpVerdict(undefined)).toBeNull();
		expect(otpVerdict(Number.NaN)).toBeNull();
	});
});

describe('isProblemVerdict', () => {
	it('treats late and severe as problems', () => {
		expect(isProblemVerdict('late')).toBe(true);
		expect(isProblemVerdict('severe')).toBe(true);
	});

	it('does not treat on_time or null as a problem', () => {
		expect(isProblemVerdict('on_time')).toBe(false);
		expect(isProblemVerdict(null)).toBe(false);
	});
});
