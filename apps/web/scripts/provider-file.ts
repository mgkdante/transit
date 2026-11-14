import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { z } from 'zod';
import { PublicProviderSchema } from '../src/lib/v1/schemas/providers';

const labels = PublicProviderSchema.shape.labels;
const legacy = z.object({
	provider: z.object({ provider_id: PublicProviderSchema.shape.id, is_active: z.boolean() }),
	public: z.object({ enabled: z.boolean(), labels: labels.optional() }).optional(),
});
const declaration = z.object({
	declaration: z.literal(2),
	id: PublicProviderSchema.shape.id,
	stage: z.enum(['candidate', 'capturing', 'public']),
	labels: labels.optional(),
});
const projection = z.object({
	id: PublicProviderSchema.shape.id,
	active: z.boolean(),
	publicEnabled: z.boolean(),
	labels: labels.optional(),
});
export function readProviderFile(path: string): z.infer<typeof projection> {
	try {
		const payload = Bun.YAML.parse(readFileSync(path, 'utf8'));
		if (payload && typeof payload === 'object' && ('declaration' in payload || 'id' in payload)) {
			if ('provider' in payload) throw new Error('mixed provider formats');
			const config = declaration.parse(payload);
			if (config.id !== basename(path, extname(path))) throw new Error('filename mismatch');
			const result = projection.parse({
				id: config.id,
				active: config.stage !== 'candidate',
				publicEnabled: config.stage === 'public',
				labels: config.labels,
			});
			if (result.active && result.publicEnabled) labels.parse(result.labels);
			return result;
		}
		const config = legacy.parse(payload);
		const result = projection.parse({
			id: config.provider.provider_id,
			active: config.provider.is_active,
			publicEnabled: config.public?.enabled ?? false,
			labels: config.public?.labels,
		});
		if (result.active && result.publicEnabled) labels.parse(result.labels);
		return result;
	} catch {
		throw new Error(`${basename(path)}: invalid provider file`);
	}
}
