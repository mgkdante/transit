import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(process.cwd(), '../..');
const wrangler = readFileSync(resolve(repoRoot, 'apps/web/wrangler.toml'), 'utf8');
const workflow = readFileSync(resolve(repoRoot, '.github/workflows/web.yml'), 'utf8');

function productionRoutePatterns(config: string): string[] {
	const routes = /(?:^|\n)routes\s*=\s*\[([\s\S]*?)\]/.exec(config);
	if (!routes) throw new Error('production routes block missing from apps/web/wrangler.toml');
	return [...routes[1].matchAll(/pattern\s*=\s*"([^"]+)"/g)].map((match) => match[1]);
}

describe('shared production route deployment', () => {
	it('keeps the web Worker on the apex catch-all only', () => {
		expect(productionRoutePatterns(wrangler)).toEqual(['transit.yesid.dev/*']);
	});

	it('limits manual production deploys to main and smokes shared routes afterward', () => {
		const productionJob = workflow.split('  deploy-production:', 2)[1];
		expect(productionJob).toContain(
			"github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.deploy_target == 'production'",
		);

		const deployIndex = productionJob.indexOf('run: bunx wrangler@4.100.0 deploy --env=""');
		const smokeIndex = productionJob.indexOf('run: bash smoke.sh');
		expect(deployIndex).toBeGreaterThanOrEqual(0);
		expect(smokeIndex).toBeGreaterThan(deployIndex);
		expect(productionJob.slice(deployIndex, smokeIndex)).toContain(
			'working-directory: apps/data-proxy',
		);
	});
});
