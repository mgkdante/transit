import { render } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import ArticleKeywords from './ArticleKeywords.svelte';
it.each([
	['', 'STM', ''],
	['STM', '', 'OC Transpo'],
	['', ''],
])('joins only present keyword values: %j', (...keywords) => {
	const { container } = render(ArticleKeywords, { props: { label: 'Sources', keywords } });
	expect(container.querySelector('p:last-child')?.textContent?.trim()).toBe(
		keywords.filter(Boolean).join(' · '),
	);
});
