import { stopDisplayName } from '#lib/site/transitDisplay.ts';
import { stopPageTitle } from '#lib/seo/riderPageTitle.ts';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canonicalDetailTabLocation } from '#lib/site/detailTabs.ts';
import { getStop } from '#lib/v1/repositories/static.ts';
import { serverV1Context, type IdentitySeed } from '#lib/v1/serverContext.ts';

export const load: PageServerLoad = async (event) => {
	const canonicalLocation = canonicalDetailTabLocation(event.url);
	if (canonicalLocation) redirect(308, canonicalLocation);

	const id = event.params.id.trim() || event.params.id;
	const fallback: IdentitySeed = { id, name: id };
	const { v1, lang } = await event.parent();
	if (!v1) return { seed: fallback, stopSeed: null };

	try {
		const stop = await getStop(id, {
			...serverV1Context(event),
			providerId: v1.manifest.provider,
			manifest: v1.manifest,
		});
		const name = stop?.name.trim();
		return {
			seed: name ? { id, name } : fallback,
			stopSeed: { key: id, data: stop },
			...(name ? { seoTitle: stopPageTitle(stopDisplayName(name), stop?.code, lang) } : {}),
		};
	} catch {
		return { seed: fallback, stopSeed: null };
	}
};
