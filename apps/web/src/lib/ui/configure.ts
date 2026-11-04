import { cn as uiCn, configureUi, createCn } from '@yesid/ui/cn';

let configuredForTransit = false;
let standaloneCn: typeof uiCn | undefined;

export function configureTransitUi(): void {
	configureUi();
	configuredForTransit = true;
	standaloneCn = undefined;
}

export const cn: typeof uiCn = (...inputs) => {
	if (configuredForTransit) return uiCn(...inputs);
	return (standaloneCn ??= createCn())(...inputs);
};
