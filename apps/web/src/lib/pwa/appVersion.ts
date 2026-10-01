export const VERSION_POLL_INTERVAL_MS = 60_000;

export interface FreshnessReloadDecision {
	readonly reload: boolean;
	readonly href: string | null;
}

const NO_RELOAD: FreshnessReloadDecision = { reload: false, href: null };

export function decideFreshnessReload(input: {
	hasNewVersion: boolean;
	willUnload: boolean;
	toHref: string | null | undefined;
}): FreshnessReloadDecision {
	if (!input.hasNewVersion) return NO_RELOAD;
	if (input.willUnload) return NO_RELOAD;
	if (!input.toHref) return NO_RELOAD;
	return { reload: true, href: input.toHref };
}
