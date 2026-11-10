import original from './playwright.config';
import { defineConfig } from '@playwright/test';

// Preserve project names used by specs. Layout keeps the two requested sizes;
// interaction and HTTP specs use the existing phone and desktop projects.
export default defineConfig(
	process.argv.includes('--project=*')
		? original
		: {
				...original,
				projects: original.projects
					?.filter((project) =>
						['phone', 'desktop', 'layout-chromium-390-light', 'layout-webkit-1440-light'].includes(
							project.name ?? '',
						),
					)
					.map((project) => ({
						...project,
						testIgnore: project.name?.startsWith('layout-') ? [] : [/layout.*\.spec\.ts/],
					})),
			},
);
