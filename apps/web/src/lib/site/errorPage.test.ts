import { describe, expect, it } from 'vitest';
import { errorDocumentHead, errorPageCopy } from './errorPage';

describe('error page shared copy', () => {
	it('builds the exact 404 head in both locales', () => {
		expect(errorDocumentHead(404, 'en')).toEqual({
			title: '404 · This station is under construction',
			description:
				"The route you requested doesn't exist or has been rerouted. Here are some active destinations:",
		});
		expect(errorDocumentHead(404, 'fr').title).toBe('404 · Cette station est en construction');
	});

	it('keeps Transit destinations centralized for the rendered page', () => {
		expect(errorPageCopy.en.notFound.suggestions.map(({ href }) => href)).toEqual([
			'/lines',
			'/stops',
			'/network',
		]);
	});

	it('uses the generic error heading for non-404 statuses', () => {
		expect(errorDocumentHead(500, 'en').title).toBe('500 · Something went wrong');
	});
});
