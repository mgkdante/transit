import { ogFontFiles } from '@yesid/seo-kit/og/files';
import { createOgCardRenderer } from '../src/lib/og/render';
import { resolveCardTitle } from '../src/lib/seo/routeSeo';
import { SHARE_COPY, shareCopy } from '../src/lib/seo/share-copy';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PublicProviderSchema } from '../src/lib/v1/schemas/providers';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../static/og');

const renderer = createOgCardRenderer(ogFontFiles);
const card = (path: string, locale: 'en' | 'fr', title?: string) => ({
	eyebrow: 'TRANSIT',
	title: title ?? resolveCardTitle(path, locale),
	subtitle: shareCopy(path, locale).support,
	cta: shareCopy(path, locale).cta,
	ctaTone: 'action' as const,
});

const checkOnly = process.argv.includes('--check');
let drift = false;
mkdirSync(OUT_DIR, { recursive: true });

const providerDir = resolve(OUT_DIR, '../../../db/config/providers');
const providerConfig = z.object({
	provider: z.object({ provider_id: PublicProviderSchema.shape.id, is_active: z.boolean() }),
	public: z
		.object({ enabled: z.boolean(), labels: PublicProviderSchema.shape.labels.optional() })
		.optional(),
});
const providers = readdirSync(providerDir)
	.filter((file) => file.endsWith('.yaml'))
	.sort()
	.map((file) =>
		providerConfig.parse(Bun.YAML.parse(readFileSync(resolve(providerDir, file), 'utf8'))),
	)
	.flatMap((config) =>
		config.provider.is_active && config.public?.enabled
			? [
					PublicProviderSchema.pick({ id: true, labels: true }).parse({
						id: config.provider.provider_id,
						labels: config.public.labels,
					}),
				]
			: [],
	);
if (new Set(providers.map((provider) => provider.id)).size !== providers.length)
	throw new Error('Duplicate public provider IDs');
const outputs: Record<string, string> = {};

function save(file: string, bytes: Buffer): void {
	const outPath = resolve(OUT_DIR, file);
	if (!checkOnly) {
		mkdirSync(dirname(outPath), { recursive: true });
		writeFileSync(outPath, bytes);
		console.log(`[build-og] wrote ${outPath} (${bytes.length} bytes)`);
	} else if (!existsSync(outPath) || !readFileSync(outPath).equals(bytes)) {
		drift = true;
		console.error(
			`[build-og] DRIFT: ${outPath} is missing or stale. Run \`bun scripts/build-og.ts\`.`,
		);
	}
}

for (const locale of ['en', 'fr'] as const) {
	const output = (file: string, path: string, title?: string) => {
		const png = Buffer.from(renderer.png(card(path, locale, title)));
		if (png.length >= 150_000) throw new Error('OG card exceeds 150KB: ' + file);
		save(file, png);
		outputs['/og/' + file] = createHash('sha256').update(png).digest('hex');
	};
	output(locale + '.png', '/');
	for (const path of Object.keys(SHARE_COPY).filter((path) => path !== '/'))
		output('pages/' + path.slice(1).replaceAll('/', '-') + '.' + locale + '.png', path);
	for (const provider of providers) {
		const label = provider.labels[locale];
		const title =
			locale === 'en' ? label.operator + ' network overview' : 'Vue du réseau ' + label.operator;
		output('home/' + provider.id + '.' + locale + '.png', '/', title);
	}
}
save('manifest.json', Buffer.from(JSON.stringify({ providers, outputs }, null, 2) + '\n'));
if (drift) process.exit(1);
