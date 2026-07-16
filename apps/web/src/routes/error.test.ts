import { render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorPage from './+error.svelte';

const pageState = vi.hoisted(() => ({
	value: {
		status: 404,
		error: null as { message?: string } | null,
		url: new URL('https://transit.yesid.dev/missing'),
	},
}));

vi.mock('$app/stores', () => ({
	page: {
		subscribe(run: (value: typeof pageState.value) => void) {
			run(pageState.value);
			return () => {};
		},
	},
}));

beforeEach(() => {
	pageState.value = {
		status: 404,
		error: null,
		url: new URL('https://transit.yesid.dev/missing'),
	};
});

describe('error route', () => {
	it('renders the approved construction composition with Transit destinations for a 404', () => {
		const { container } = render(ErrorPage);

		expect(screen.getByTestId('hazard-tape')).toBeInTheDocument();
		expect(screen.getByTestId('construction-scene')).toBeInTheDocument();
		expect(screen.getByText('ROUTE NOT FOUND')).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { level: 1, name: 'This station is under construction' }),
		).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Lines/ })).toHaveAttribute('href', '/lines');
		expect(screen.getByRole('link', { name: /Stops/ })).toHaveAttribute('href', '/stops');
		expect(screen.getByRole('link', { name: /Network/ })).toHaveAttribute('href', '/network');
		expect(screen.getByTestId('terminal-line')).toHaveTextContent('route --status 404');
		expect(container.querySelectorAll('[data-testid="hazard-tape"]')).toHaveLength(1);
		expect(document.title).toBe('404 · This station is under construction · Transit');
		expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
			'content',
			'noindex,nofollow',
		);
	});

	it('localizes the 404 copy and all Transit destination paths in French', () => {
		pageState.value = {
			status: 404,
			error: null,
			url: new URL('https://transit.yesid.dev/fr/introuvable'),
		};

		render(ErrorPage);

		expect(screen.getByText('ROUTE INTROUVABLE')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Lignes/ })).toHaveAttribute('href', '/fr/lines');
		expect(screen.getByRole('link', { name: /Arrêts/ })).toHaveAttribute('href', '/fr/stops');
		expect(screen.getByRole('link', { name: /Réseau/ })).toHaveAttribute('href', '/fr/network');
	});

	it('preserves the generic error treatment and never presents a 500 as a 404 construction sign', () => {
		pageState.value = {
			status: 500,
			error: { message: 'Database unavailable' },
			url: new URL('https://transit.yesid.dev/network'),
		};

		render(ErrorPage);

		expect(
			screen.getByRole('heading', { level: 1, name: 'Something went wrong' }),
		).toBeInTheDocument();
		expect(screen.getByText('Database unavailable')).toBeInTheDocument();
		expect(screen.getByText('500')).toBeInTheDocument();
		expect(screen.queryByTestId('construction-scene')).not.toBeInTheDocument();
	});

	it('ports the yesid viewport rhythm without pinning short phones to a clipping height', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/routes/+error.svelte'), 'utf8');

		expect(source).toMatch(/\.error-page\s*\{[\s\S]*?min-height:\s*calc\(100dvh - 5rem\)/);
		expect(source).not.toMatch(/(?:^|[;{])\s*height:\s*calc\(100dvh\s*-\s*5rem\)/m);
		expect(source).toMatch(/\.error-illustration\s*\{[^}]*max-width:\s*24rem/s);
		expect(source).toMatch(/@media\s*\(min-width:\s*640px\)[\s\S]*?max-width:\s*28rem/);
		expect(source).toMatch(/\.error-copy h1\s*\{[^}]*font-size:\s*1\.5rem/s);
		expect(source).toMatch(
			/@media\s*\(min-width:\s*640px\)[\s\S]*?\.error-copy h1\s*\{[^}]*font-size:\s*2\.25rem/,
		);
		expect(source).toMatch(/\.suggestions a\s*\{[^}]*min-width:\s*7\.25rem/s);
	});
});
