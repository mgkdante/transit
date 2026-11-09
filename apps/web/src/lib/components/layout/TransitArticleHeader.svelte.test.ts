import { render, screen } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import TransitArticleHeader from './TransitArticleHeader.svelte';
it('keeps the complete headline accessible and omits missing metadata entries', () => {
	const name = 'Boulevard Saint-Laurent et Avenue du Mont-Royal';
	const { container } = render(TransitArticleHeader, {
		props: {
			title: name,
			backHref: '/',
			backLabel: 'Back',
			meta: ['', { label: 'Missing', text: '' }, 'STM'],
		},
	});
	expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(name);
	expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('title', name);
	expect(container.querySelectorAll('.header__meta-item')).toHaveLength(1);
	expect(container.querySelector('.header__meta-sep')).toBeNull();
	expect(container.querySelector('[data-allow-clip]')).toHaveAttribute('aria-hidden', 'true');
	expect(screen.getByRole('heading')).not.toHaveAttribute('data-allow-clip');
});
