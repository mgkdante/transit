import { expect, it } from 'vitest';
import { resolvePageTitle } from './pageTitle';

it('a page title wins over the path title, and an error title wins over both', () => {
	expect(resolvePageTitle('Error', 'Client', 'Server', 'Path')).toBe('Error');
	expect(resolvePageTitle(null, 'Client', 'Server', 'Path')).toBe('Client');
	expect(resolvePageTitle(null, ' ', 'Server', 'Path')).toBe('Server');
	expect(resolvePageTitle('', null, ' ', 'Path')).toBe('Path');
});
