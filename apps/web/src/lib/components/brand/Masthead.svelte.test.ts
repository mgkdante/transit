// Masthead.svelte.test.ts — DOM + source gate for the ONE surface head family (§C2, P5.4a).
//
// Guards the merged head (kicker → title+dot → lede → meta → children → tape): that
// the title is a REAL h1 with exactly ONE brand dot, that the optional zones render
// only when supplied, the vertical zone order, and that the closing hazard tape is
// reused (not reinvented). This is the SurfaceHeader + ArticleShell merge — one head.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Masthead from './Masthead.svelte';

const meta = createRawSnippet(() => ({
	render: () => `<span data-testid="meta">provider · window · 12:00Z</span>`,
}));
const cornerMeta = createRawSnippet(() => ({
	render: () => `<span data-testid="corner">SRC · STM</span>`,
}));
const children = createRawSnippet(() => ({
	render: () => `<div data-testid="body">control rail</div>`,
}));

const mastheadSource = () =>
	readFileSync(resolve(process.cwd(), 'src/lib/components/brand/Masthead.svelte'), 'utf-8');

describe('Masthead — structure', () => {
	it('renders the title as a real h1 (page masthead by default) with exactly one brand dot', () => {
		const { container } = render(Masthead, {
			props: { kicker: 'NETWORK · LIVE', heading: 'Network health' },
		});
		const h1 = container.querySelector('h1');
		expect(h1?.textContent).toContain('Network health');
		// Exactly ONE orange dot — the one-h1-one-dot law.
		expect(container.querySelectorAll('[data-slot="section-heading-dot"]')).toHaveLength(1);
	});

	it('honours a custom heading level', () => {
		const { container } = render(Masthead, {
			props: { kicker: 'K', heading: 'Preamble', level: 2 },
		});
		expect(container.querySelector('h2')).not.toBeNull();
		expect(container.querySelector('h1')).toBeNull();
	});

	it('renders the station-voice kicker via SectionLabel', () => {
		const { container } = render(Masthead, {
			props: { kicker: 'HOTSPOTS · DAILY', heading: 'T' },
		});
		const kicker = container.querySelector('.label-station');
		expect(kicker?.textContent).toContain('HOTSPOTS · DAILY');
	});

	it('renders the capped lede when supplied', () => {
		const { container } = render(Masthead, {
			props: { kicker: 'K', heading: 'T', lede: 'The measured proxy.' },
		});
		expect(container.querySelector('.masthead-lede')?.textContent).toContain('The measured proxy.');
	});

	it('renders the meta, cornerMeta and children zones when supplied', () => {
		const { getByTestId, container } = render(Masthead, {
			props: { kicker: 'K', heading: 'T', meta, cornerMeta, children },
		});
		expect(getByTestId('meta')).toBeInTheDocument();
		expect(getByTestId('corner')).toBeInTheDocument();
		expect(getByTestId('body')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="masthead-meta"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="masthead-body"]')).not.toBeNull();
		// cornerMeta makes the head the relative host for the corner readouts.
		expect(container.querySelector('.masthead-head--cornered')).not.toBeNull();
	});

	it('omits optional zones when their props are absent', () => {
		const { container } = render(Masthead, { props: { kicker: 'K', heading: 'T' } });
		expect(container.querySelector('.masthead-lede')).toBeNull();
		expect(container.querySelector('[data-slot="masthead-meta"]')).toBeNull();
		expect(container.querySelector('[data-slot="masthead-body"]')).toBeNull();
		expect(container.querySelector('.masthead-head--cornered')).toBeNull();
	});

	it('wires the heading id for a section aria-labelledby', () => {
		const { container } = render(Masthead, {
			props: { kicker: 'K', heading: 'T', headingId: 'network-head' },
		});
		expect(container.querySelector('#network-head')?.textContent).toContain('T');
	});
});

describe('Masthead — vertical zone order', () => {
	it('orders head → body → tape in source order', () => {
		const { container } = render(Masthead, {
			props: { kicker: 'K', heading: 'T', meta, children },
		});
		const root = container.querySelector('[data-slot="masthead"]')!;
		const kinds = Array.from(root.children).map(
			(el) => el.getAttribute('data-slot') ?? el.className,
		);
		const headIdx = kinds.findIndex((k) => k.includes('masthead-head'));
		const bodyIdx = kinds.indexOf('masthead-body');
		const tapeIdx = kinds.findIndex((k) => k.includes('masthead-tape'));
		expect(headIdx).toBe(0);
		expect(bodyIdx).toBeGreaterThan(headIdx);
		expect(tapeIdx).toBeGreaterThan(bodyIdx);
	});

	it('orders kicker → heading → lede → meta inside the head', () => {
		const { container } = render(Masthead, {
			props: { kicker: 'K', heading: 'T', lede: 'L', meta },
		});
		const head = container.querySelector('.masthead-head')!;
		const marks = Array.from(head.children).map(
			(el) => el.getAttribute('data-slot') ?? el.className,
		);
		expect(marks[0]).toContain('section-label'); // the SectionLabel kicker
		expect(marks[1]).toContain('section-heading'); // the SectionHeading wrapper
		expect(marks[2]).toContain('masthead-lede');
		expect(marks[3]).toContain('masthead-meta');
	});
});

describe('Masthead — lede measure + tape (source contract)', () => {
	it('caps the lede to the ~52ch surface reading measure', () => {
		expect(mastheadSource()).toMatch(/\.masthead-lede\s*\{[^}]*max-width:\s*52ch/);
	});

	it('reuses the hazard Separator (does not reinvent the tape)', () => {
		expect(mastheadSource()).toMatch(/Separator[\s\S]*variant="hazard"/);
	});

	it('renders the closing hazard tape by default', () => {
		const { container } = render(Masthead, { props: { kicker: 'K', heading: 'T' } });
		expect(container.querySelector('.masthead-tape')).not.toBeNull();
	});

	it('drops the tape when tape={false}', () => {
		const { container } = render(Masthead, {
			props: { kicker: 'K', heading: 'T', tape: false },
		});
		expect(container.querySelector('.masthead-tape')).toBeNull();
	});
});
