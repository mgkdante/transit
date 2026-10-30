import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
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
