import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SeverityBar from './SeverityBar.svelte';

const fillWidth = (c: HTMLElement): number | null => {
	const fill = c.querySelector('.dv-severity-fill') as HTMLElement | null;
	return fill ? parseFloat(fill.style.width) : null;
};

describe('SeverityBar — absolute domain (S7 relative-to-max fix)', () => {
	it('scales the bar from a FIXED domain (value is absolute)', () => {
		const { container } = render(SeverityBar, {
			props: { severity: 'high', value: 12, domain: [0, 35] },
		});
		expect(fillWidth(container)).toBeCloseTo((12 / 35) * 100, 1); // ~34.3%
	});

	it('is STABLE — the same value + domain renders the same length, independent of other data', () => {
		// 4 min on [-2, 8] -> (4 - -2)/10 = 60%, no matter the severity or any in-view max.
		const a = render(SeverityBar, { props: { severity: 'high', value: 4, domain: [-2, 8] } });
		const b = render(SeverityBar, { props: { severity: 'critical', value: 4, domain: [-2, 8] } });
		expect(fillWidth(a.container)).toBeCloseTo(60, 1);
		expect(fillWidth(a.container)).toBeCloseTo(fillWidth(b.container)!, 5);
	});

	it('clamps out-of-range absolute values to [0,100]%', () => {
		const { container } = render(SeverityBar, {
			props: { severity: 'critical', value: 40, domain: [0, 35] },
		});
		expect(fillWidth(container)).toBe(100);
	});

	it('renders an early (negative) value below the domain floor as 0% (caret territory)', () => {
		const { container } = render(SeverityBar, {
			props: { severity: 'watch', value: -2, domain: [0, 35] },
		});
		expect(fillWidth(container)).toBe(0);
	});

	it('keeps the legacy [0,1] fraction path when no domain is given', () => {
		const { container } = render(SeverityBar, { props: { severity: 'watch', value: 0.5 } });
		expect(fillWidth(container)).toBeCloseTo(50, 5);
	});

	it('null value renders no fill (honest empty track)', () => {
		const { container } = render(SeverityBar, {
			props: { severity: 'watch', value: null, domain: [0, 35] },
		});
		expect(container.querySelector('.dv-severity-fill')).toBeNull();
	});
});
