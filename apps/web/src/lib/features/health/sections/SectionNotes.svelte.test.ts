import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import SectionNotes from './SectionNotes.svelte';
import { copy } from '../health.copy';

const notes = [
	{ key: 'network_no_data', label: 'Network no-data honesty', text: 'null not 0', kind: 'caveat' },
	{ key: 'wilson_z', label: 'CI z-score', text: 'z = 1.96', kind: 'math' },
	{ key: 'new_note', label: 'new note', text: 'verbatim note', kind: 'pipeline-note' },
] as const;

describe('SectionNotes', () => {
	it('renders one typed card per note without changing labels or verbatim text', () => {
		const { container } = render(SectionNotes, { props: { notes, copy: copy.en } });
		expect(container.querySelectorAll('[data-slot="typed-information-card"]')).toHaveLength(3);
		expect(screen.getByText('Network no-data honesty')).toBeInTheDocument();
		expect(screen.getByText('null not 0')).toBeInTheDocument();
		expect(screen.getByText('z = 1.96')).toBeInTheDocument();
		expect(container.querySelector('[data-kind="caveat"] .lucide-triangle-alert')).not.toBeNull();
		expect(container.querySelector('[data-kind="math"] .lucide-sigma')).not.toBeNull();
		expect(container.querySelector('[data-kind="pipeline-note"] .lucide-workflow')).not.toBeNull();
	});

	it('uses the same foreground article body for every note kind and its section note', () => {
		const { container } = render(SectionNotes, { props: { notes, copy: copy.en } });
		const bodies = Array.from(
			container.querySelectorAll<HTMLElement>('[data-slot="typed-information-body"]'),
		);
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/health/sections/SectionNotes.svelte'),
			'utf8',
		);
		expect(bodies).toHaveLength(notes.length);
		for (const body of bodies) {
			expect(body).not.toHaveClass('typed-information-body--mono');
		}
		expect(source).toMatch(
			/\.health-note\s*\{[\s\S]*?color:\s*var\(--foreground\)/,
		);
		expect(source).not.toMatch(
			/\.health-note\s*\{[\s\S]*?color:\s*var\(--muted-foreground\)/,
		);
	});
});
