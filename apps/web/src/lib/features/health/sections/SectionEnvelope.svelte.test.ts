import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import SectionEnvelope from './SectionEnvelope.svelte';
import { copy } from '../health.copy';

const envelope = {
	generationId: 'generation-2026-07-10-very-long-deterministic-publish-run-identifier',
	schemaVersion: '3',
	methodologyVersion: 'historic-2',
};

describe('SectionEnvelope', () => {
	it('renders Publish run as a dedicated stacked card with the ID before its exact explanation', () => {
		const { container } = render(SectionEnvelope, {
			props: { envelope, copy: copy.en, locale: 'en' },
		});
		const card = container.querySelector('[data-slot="publish-run-card"]') as HTMLElement;
		const id = container.querySelector('[data-slot="publish-run-id"]') as HTMLElement;
		const explanation = container.querySelector(
			'[data-slot="publish-run-explanation"]',
		) as HTMLElement;

		expect(card).not.toBeNull();
		expect(id).toHaveTextContent(envelope.generationId);
		expect(explanation).toHaveTextContent(copy.en.envelope.generationIdExplain);
		expect(id.compareDocumentPosition(explanation) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
		expect(container.querySelector('[data-slot="explained-metric-card"]')).toBeNull();
	});

	it('stacks envelope rows below 1024px and makes long publish IDs break-safe', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/health/sections/SectionEnvelope.svelte'),
			'utf8',
		);
		const rowRules = Array.from(source.matchAll(/\.envelope-rows\s*\{([^}]*)\}/g));

		expect(rowRules).toHaveLength(2);
		expect(rowRules[0]?.[1]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
		expect(rowRules[0]?.[1]).not.toMatch(/repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
		expect(rowRules[1]?.[1]).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);

		const desktopMedia = source.lastIndexOf('@media (min-width: 1024px)', rowRules[1]?.index);
		expect(desktopMedia).toBeGreaterThan(rowRules[0]?.index ?? -1);
		expect(source).toMatch(
			/\.publish-run-id\s*\{[^}]*font-family:\s*var\(--font-mono\);[^}]*overflow-wrap:\s*anywhere;/,
		);
	});

	it('preserves the exact French Publish run label and explanation', () => {
		render(SectionEnvelope, {
			props: { envelope, copy: copy.fr, locale: 'fr' },
		});

		expect(screen.getByText(copy.fr.envelope.generationIdLabel)).toBeInTheDocument();
		expect(screen.getByText(copy.fr.envelope.generationIdExplain)).toBeInTheDocument();
	});

	it('renders an honest absence when the publish-run ID is not reported', () => {
		const { container } = render(SectionEnvelope, {
			props: { envelope: { ...envelope, generationId: null }, copy: copy.en, locale: 'en' },
		});

		expect(container.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		expect(container).not.toHaveTextContent(envelope.generationId);
	});
});
