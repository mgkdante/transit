import { cn as uiCn, configureUi, createCn } from '@yesid/ui/cn';
import { TRANSIT_VOCAB } from '$lib/utils/cn-vocab';

let configuredForTransit = false;
let standaloneCn: typeof uiCn | undefined;

export function configureTransitUi(): void {
	configureUi({ vocab: TRANSIT_VOCAB });
	configuredForTransit = true;
	standaloneCn = undefined;
}

export const cn: typeof uiCn = (...inputs) => {
	if (configuredForTransit) return uiCn(...inputs);
	return (standaloneCn ??= createCn(TRANSIT_VOCAB))(...inputs);
};
