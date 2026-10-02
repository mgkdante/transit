import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SeoHead from './SeoHead.svelte';

const props = {
	title: 'Lines',
	description: 'Browse transit lines.',
	locale: 'en',
	path: '/lines',
	siteName: 'Transit',
	dev: true,
} as const;

beforeEach(() => {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('SeoHead authoring hints', () => {
	it.each([
		{ name: 'a concise description', description: props.description },
		{ name: 'a description at the 160-character hint boundary', description: 'a'.repeat(160) },
	])('accepts $name without warning', ({ description }) => {
		render(SeoHead, { props: { ...props, description } });
		expect(console.warn).not.toHaveBeenCalled();
	});

	it.each(['', ' \t\n '])('warns about a blank description (%j)', (description) => {
		render(SeoHead, { props: { ...props, description } });
		expect(console.warn).toHaveBeenCalledExactlyOnceWith(
			'[SeoHead] description is blank. path: /lines',
		);
		expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute(
			'content',
			description,
		);
	});

	it('suggests concise copy above 160 characters without altering emitted descriptions', () => {
		const description = 'a'.repeat(161);
		render(SeoHead, { props: { ...props, description } });
		expect(console.warn).toHaveBeenCalledExactlyOnceWith(
			'[SeoHead] description > 160 chars (161); consider more concise copy. path: /lines',
		);
		for (const selector of [
			'meta[name="description"]',
			'meta[property="og:description"]',
			'meta[name="twitter:description"]',
		]) {
			expect(document.head.querySelector(selector)).toHaveAttribute('content', description);
		}
	});

	it('retains the title-length hint independently of description length', () => {
		render(SeoHead, { props: { ...props, title: 'a'.repeat(61) } });
		expect(console.warn).toHaveBeenCalledExactlyOnceWith(
			'[SeoHead] title > 60 chars (71), may truncate in search. path: /lines',
		);
	});

	it.each(['', 'a'.repeat(161)])('keeps diagnostics disabled in production (%j)', (description) => {
		render(SeoHead, { props: { ...props, description, title: 'a'.repeat(61), dev: false } });
		expect(console.warn).not.toHaveBeenCalled();
	});
});
