import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet, type Component, type Snippet } from 'svelte';
import * as Shared from './index';

type InformationKind =
	| 'definition'
	| 'math'
	| 'sql'
	| 'not-really'
	| 'caveat'
	| 'pipeline-note'
	| 'note';

interface TypedInformationCardProps {
	kind: InformationKind;
	label: string;
	code?: string;
	codeAriaLabel?: string;
	children?: Snippet;
	class?: string;
}

const TypedInformationCard = (
	Shared as typeof Shared & {
		TypedInformationCard?: Component<TypedInformationCardProps>;
	}
).TypedInformationCard;

const NON_SQL_CASES = [
	{ kind: 'definition', label: 'Definition', iconClass: 'lucide-book-open' },
	{ kind: 'math', label: 'Math', iconClass: 'lucide-sigma' },
	{ kind: 'not-really', label: 'Not really', iconClass: 'lucide-ban' },
	{ kind: 'caveat', label: 'Caveat', iconClass: 'lucide-triangle-alert' },
	{ kind: 'pipeline-note', label: 'Pipeline note', iconClass: 'lucide-workflow' },
	{ kind: 'note', label: 'Note', iconClass: 'lucide-notebook-text' },
] as const;

describe('TypedInformationCard', () => {
	it.each(NON_SQL_CASES)(
		'uses the shared non-SQL body typography for the $kind kind',
		({ kind, label }) => {
			expect(TypedInformationCard).toBeDefined();
			if (!TypedInformationCard) return;

			const children = createRawSnippet(() => ({
				render: () => `<p>Body for ${kind}</p>`,
			}));
			const { container } = render(TypedInformationCard, {
				props: { kind, label, children },
			});

			const body = container.querySelector('[data-slot="typed-information-body"]');
			expect(body).toHaveClass('typed-information-body');
			expect(body).not.toHaveClass('typed-information-body--mono');
		},
	);

	for (const { kind, label, iconClass } of NON_SQL_CASES) {
		it(`renders the ${kind} kind with its badge, icon, and children`, () => {
			expect(TypedInformationCard).toBeDefined();
			if (!TypedInformationCard) return;

			const children = createRawSnippet(() => ({
				render: () => `<p data-testid="body-${kind}">Body for ${kind}</p>`,
			}));
			const { container, getByTestId } = render(TypedInformationCard, {
				props: { kind, label, children },
			});

			const root = container.querySelector('[data-slot="typed-information-card"]');
			expect(root).toHaveAttribute('data-kind', kind);

			const badge = container.querySelector('h3[data-slot="typed-information-badge"]');
			expect(badge).toBeVisible();
			expect(badge).toHaveTextContent(label);
			expect(badge?.querySelector('svg')).toHaveClass(iconClass);
			expect(getByTestId(`body-${kind}`)).toHaveTextContent(`Body for ${kind}`);
		});
	}

	it('renders SQL in one TerminalPanel with an embedded keyboard-scrollable CodeBlock', () => {
		expect(TypedInformationCard).toBeDefined();
		if (!TypedInformationCard) return;

		const { container, getByRole } = render(TypedInformationCard, {
			props: {
				kind: 'sql',
				label: 'Defining SQL',
				code: 'SELECT 1;',
				codeAriaLabel: 'Defining SQL source',
			},
		});

		const root = container.querySelector('[data-slot="typed-information-card"][data-kind="sql"]');
		expect(root).toBeInTheDocument();
		expect(root?.querySelector('[data-slot="terminal-panel"]')).toBeInTheDocument();
		expect(root?.querySelector('.terminal-tag')).toHaveTextContent('SQL');
		expect(root?.querySelector('.codeblock__chrome')).not.toBeInTheDocument();

		const region = getByRole('region', { name: 'Defining SQL source' });
		expect(region).toHaveAttribute('tabindex', '0');
		expect(region).toHaveTextContent('SELECT 1;');
	});
});
