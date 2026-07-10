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
});
