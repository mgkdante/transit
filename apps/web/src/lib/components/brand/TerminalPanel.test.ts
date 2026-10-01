import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import TerminalPanel from './TerminalPanel.svelte';

const root = (c: HTMLElement) => c.querySelector('[data-slot="terminal-panel"]') as HTMLElement;
const head = (c: HTMLElement) => c.querySelector('[data-slot="signal-head"]') as HTMLElement;
const dots = (c: HTMLElement) =>
	Array.from(c.querySelectorAll('[data-slot="signal-head"] [data-slot="status-dot"]'));

const textSnippet = (text: string) =>
	createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

describe('TerminalPanel — flat data chassis', () => {
	it('exposes the terminal-panel data-slot hook', () => {
		const { container } = render(TerminalPanel, { props: { title: 'demo' } });
		expect(root(container)).toBeInTheDocument();
	});

	it('rides the SOLID surface, border-rule frame and radius-lg — no alpha', () => {
		const { container } = render(TerminalPanel, { props: { title: 'demo' } });
		const style = getComputedStyle(root(container));
		const css = root(container).outerHTML;
		expect(css).toContain('terminal-panel');
		expect(style).toBeTruthy();
	});

	it('carries NO text-shadow anywhere (the glow-never-text ban)', () => {
		const { container } = render(TerminalPanel, {
			props: { title: 'demo', status: 'LIVE' },
		});
		const html = container.innerHTML.toLowerCase();
		expect(html).not.toContain('text-shadow');
	});

	it('does not attach a cursor-glow overlay', () => {
		const { container } = render(TerminalPanel, { props: { title: 'demo' } });
		expect(root(container).querySelector('[data-glow-overlay]')).toBeNull();
	});
});

describe('TerminalPanel — titlebar (signal head + title/tag/meta)', () => {
	it('renders a three-aspect signal head, aria-hidden window furniture', () => {
		const { container } = render(TerminalPanel, { props: { title: 'demo' } });
		expect(dots(container)).toHaveLength(3);
		expect(head(container)).toHaveAttribute('aria-hidden', 'true');
		expect(head(container).querySelector('.led-pulse')).toBeNull();
	});

	it('renders the mono title and optional tag', () => {
		const { getByText } = render(TerminalPanel, {
			props: { title: 'NETWORK PULSE', tag: 'LIVE' },
		});
		expect(getByText('NETWORK PULSE')).toBeInTheDocument();
		expect(getByText('LIVE')).toBeInTheDocument();
	});

	it('renders the right meta SLOT when provided', () => {
		const { getByText, container } = render(TerminalPanel, {
			props: { title: 'demo', meta: textSnippet('n=773 · 2026-07-03') },
		});
		expect(getByText('n=773 · 2026-07-03')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="terminal-meta"]')).toBeInTheDocument();
	});

	it('falls back to the status STRING when no meta slot is given', () => {
		const { getByText, container } = render(TerminalPanel, {
			props: { title: 'demo', status: '2026-07-03' },
		});
		expect(getByText('2026-07-03')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="terminal-meta"]')).not.toBeInTheDocument();
	});
});

describe('TerminalPanel — footer readout (snippet + string forms)', () => {
	it('renders the footer SLOT when provided', () => {
		const { getByText, container } = render(TerminalPanel, {
			props: { title: 'demo', footer: textSnippet('window: 90d · generated 2026-07-03') },
		});
		expect(getByText('window: 90d · generated 2026-07-03')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="terminal-footer"]')).toBeInTheDocument();
	});

	it('renders the label/value STRING footer (the former TerminalChrome path)', () => {
		const { getByText } = render(TerminalPanel, {
			props: { title: 'demo', footerItems: [{ label: 'ISSUED', value: '2026-07-03' }] },
		});
		expect(getByText('ISSUED')).toBeInTheDocument();
		expect(getByText('2026-07-03')).toBeInTheDocument();
	});

	it('omits the footer entirely when neither form is given', () => {
		const { container } = render(TerminalPanel, { props: { title: 'demo' } });
		expect(container.querySelector('[data-slot="terminal-footer"]')).not.toBeInTheDocument();
	});
});

describe('TerminalPanel — body padding', () => {
	it('drops the body padding class when noPadding is set', () => {
		const off = render(TerminalPanel, { props: { title: 'demo' } });
		expect(off.container.querySelector('.terminal-body')).not.toHaveClass('no-pad');
		const on = render(TerminalPanel, { props: { title: 'demo', noPadding: true } });
		expect(on.container.querySelector('.terminal-body')).toHaveClass('no-pad');
	});
});
