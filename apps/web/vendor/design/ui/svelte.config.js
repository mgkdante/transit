import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { projectRunes } from '@yesid/config/svelte/project-runes.js';

const config = {
	compilerOptions: {
		runes: projectRunes(import.meta.dirname),
	},
	preprocess: vitePreprocess(),
};

export default config;
