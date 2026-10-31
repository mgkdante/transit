import { Resvg } from '@resvg/resvg-js';
import { OG_WIDTH, renderOgPng } from '@yesid/seo-kit/og';
import { readOgFonts } from '@yesid/seo-kit/og/files';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PublicProviderSchema } from '../src/lib/v1/schemas/providers';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../static/og');

const COPY = {
	en: {
		eyebrow: 'Transit · Network analytics',
		title: 'Transit reports, from live observations to daily reliability.',
		location: 'Public transit · Open data',
	},
	fr: {
		eyebrow: 'Transit · Analyse du réseau',
		title: 'Le réseau en chiffres, des observations aux bilans quotidiens.',
		location: 'Transport public · Données ouvertes',
	},
} as const;

const fonts = readOgFonts();
const rasterize = (svg: string) =>
	new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();

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
	const copy = COPY[locale];
	const png = Buffer.from(
		await renderOgPng(
			{ ...copy, wordmark: 'transit', handle: 'transit.yesid.dev' },
			fonts,
			rasterize,
		),
	);
	save(`${locale}.png`, png);
	outputs[`/og/${locale}.png`] = createHash('sha256').update(png).digest('hex');
	for (const provider of providers) {
		const label = provider.labels[locale];
		const file = `home/${provider.id}.${locale}.png`;
		const variant = Buffer.from(
			await renderOgPng(
				{
					...copy,
					eyebrow: `${label.operator} · ${locale === 'fr' ? 'Analyse du réseau' : 'Network analytics'}`,
					location: label.city,
					wordmark: 'transit',
					handle: 'transit.yesid.dev',
				},
				fonts,
				rasterize,
			),
		);
		save(file, variant);
		outputs[`/og/${file}`] = createHash('sha256').update(variant).digest('hex');
	}
}

save('manifest.json', Buffer.from(`${JSON.stringify({ providers, outputs }, null, 2)}\n`));

if (drift) process.exit(1);
