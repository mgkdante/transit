import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** Flat config — SvelteKit 2 / Svelte 5 (runes) / TypeScript. */
export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
		},
		rules: {
			// Allow intentional throwaways with a leading underscore.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
			],
			'@typescript-eslint/no-explicit-any': 'warn',
			// Internal navigation is centralized: i18n paths go through
			// $lib/i18n localizeHref() and the $lib/nav intent layer; ui/button
			// is a generic primitive accepting arbitrary (incl. external) hrefs.
			// resolve() does not fit computed i18n hrefs, so this rule is off.
			'svelte/no-navigation-without-resolve': 'off',
		},
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: { parser: ts.parser },
		},
	},
	{
		ignores: [
			'.svelte-kit/',
			'build/',
			'dist/',
			'node_modules/',
			'.wrangler/',
			'src/lib/styles/tokens.css',
			'src/lib/motion/tokens.ts',
			'src/lib/v1/schemas/json/',
			'tools/tokens/**',
			'vendor/',
		],
	},
);
