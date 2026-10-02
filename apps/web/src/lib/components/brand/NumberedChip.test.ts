import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import NumberedChip from './NumberedChip.svelte';

const chip = (c: HTMLElement) => c.querySelector('[data-slot="numbered-chip"]') as HTMLElement;

describe('NumberedChip — zero-padded index', () => {
	it('pads a single-digit value to two digits', () => {
		const { container } = render(NumberedChip, { props: { value: 3 } });
		expect(chip(container).textContent).toBe('03');
	});

	it('renders a two-digit value unchanged', () => {
		const { container } = render(NumberedChip, { props: { value: 12 } });
		expect(chip(container).textContent).toBe('12');
	});

	it('keeps all digits of a three-digit section index', () => {
		const { container } = render(NumberedChip, { props: { value: 161 } });
		expect(chip(container).textContent).toBe('161');
	});

	it('truncates a fractional value before padding', () => {
		const { container } = render(NumberedChip, { props: { value: 4.9 } });
		expect(chip(container).textContent).toBe('04');
	});
});

describe('NumberedChip — geometry (tabular-nums so a ToC column aligns)', () => {
	it('rides tabular-nums via the numbered-chip class', () => {
		const { container } = render(NumberedChip, { props: { value: 1 } });
		expect(chip(container)).toHaveClass('numbered-chip');
		expect(chip(container).getAttribute('class')).toContain('numbered-chip');
	});
});

describe('NumberedChip — a11y (decorative by default)', () => {
	it('is aria-hidden by default (the index repeats DOM order)', () => {
		const { container } = render(NumberedChip, { props: { value: 2 } });
		expect(chip(container)).toHaveAttribute('aria-hidden', 'true');
	});

	it('drops aria-hidden when decorative=false', () => {
		const { container } = render(NumberedChip, { props: { value: 2, decorative: false } });
		expect(chip(container)).not.toHaveAttribute('aria-hidden');
	});
});

describe('NumberedChip — tone + pass-through', () => {
	it('defaults to the rest tone', () => {
		const { container } = render(NumberedChip, { props: { value: 1 } });
		expect(chip(container)).toHaveAttribute('data-tone', 'rest');
	});

	it('sets the active tone hook when tone="active"', () => {
		const { container } = render(NumberedChip, { props: { value: 1, tone: 'active' } });
		expect(chip(container)).toHaveAttribute('data-tone', 'active');
	});

	it('merges a consumer class and passes arbitrary attributes through', () => {
		const { container } = render(NumberedChip, {
			props: { value: 1, class: 'my-chip', 'data-testid': 'idx' },
		});
		expect(chip(container)).toHaveClass('numbered-chip', 'my-chip');
		expect(chip(container)).toHaveAttribute('data-testid', 'idx');
	});
});
