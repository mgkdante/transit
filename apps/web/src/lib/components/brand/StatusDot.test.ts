import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import StatusDot from './StatusDot.svelte';

const STATUS_COLOUR: Record<string, string> = {
	early: 'bg-dataviz-status-early',
	on_time: 'bg-dataviz-status-on-time',
	late: 'bg-dataviz-status-late',
	severe: 'bg-dataviz-status-severe',
	unknown: 'bg-dataviz-status-unknown',
};

const SIGNAL_COLOUR: Record<string, string> = {
	orange: 'bg-primary',
	green: 'bg-[var(--signal-proceed)]',
	caution: 'bg-[var(--signal-caution)]',
	stop: 'bg-[var(--signal-stop)]',
	lunar: 'bg-[var(--signal-lunar)]',
};

const dot = (container: HTMLElement) =>
	container.querySelector('[data-slot="status-dot"]') as HTMLElement;

describe('StatusDot — DATA colour per v1 StatusCode (dataviz scale)', () => {
	for (const [code, cls] of Object.entries(STATUS_COLOUR)) {
		it(`status "${code}" rides ${cls}`, () => {
			const { container } = render(StatusDot, { props: { color: code as never } });
			expect(dot(container)).toHaveClass(cls);
		});
	}

	it('no StatusCode dot uses an affordance fill (no bg-primary/success/destructive)', () => {
		for (const code of Object.keys(STATUS_COLOUR)) {
			const { container } = render(StatusDot, { props: { color: code as never } });
			const el = dot(container);
			expect(el).not.toHaveClass('bg-primary');
			expect(el).not.toHaveClass('bg-success');
			expect(el).not.toHaveClass('bg-destructive');
		}
	});
});

describe('StatusDot — signal aspects + interactive default', () => {
	for (const [aspect, cls] of Object.entries(SIGNAL_COLOUR)) {
		it(`signal "${aspect}" rides ${cls}`, () => {
			const { container } = render(StatusDot, { props: { color: aspect as never } });
			expect(dot(container)).toHaveClass(cls);
		});
	}

	it('defaults to the interactive orange (bg-primary) when no color is given', () => {
		const { container } = render(StatusDot, {});
		expect(dot(container)).toHaveClass('bg-primary');
	});
});

describe('StatusDot — a11y label (text equivalent for colour)', () => {
	it('renders the label as visually-hidden text when provided', () => {
		const { container, getByText } = render(StatusDot, {
			props: { color: 'late' as never, label: 'Delayed' },
		});
		const label = getByText('Delayed');
		expect(label).toBeInTheDocument();
		expect(label).toHaveClass('sr-only');
		expect(dot(container).contains(label)).toBe(true);
	});

	it('renders no text node when no label is given (colour-only dot, glyph at call site)', () => {
		const { container } = render(StatusDot, { props: { color: 'on_time' as never } });
		expect(dot(container).textContent?.trim()).toBe('');
	});
});

describe('StatusDot — structure + pass-through', () => {
	it('applies the pulse animation class only when pulse=true', () => {
		const off = render(StatusDot, { props: { color: 'severe' as never } });
		expect(dot(off.container)).not.toHaveClass('led-pulse');
		const on = render(StatusDot, { props: { color: 'severe' as never, pulse: true } });
		expect(dot(on.container)).toHaveClass('led-pulse');
	});

	it('passes arbitrary HTML attributes (e.g. aria-label) through to the span', () => {
		const { container } = render(StatusDot, {
			props: { color: 'unknown' as never, 'aria-label': 'No realtime' },
		});
		expect(dot(container)).toHaveAttribute('aria-label', 'No realtime');
	});

	it('grows to the md size class when size="md"', () => {
		const { container } = render(StatusDot, { props: { color: 'early' as never, size: 'md' } });
		expect(dot(container)).toHaveClass('size-2.5');
	});
});
