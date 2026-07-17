import { configureUi } from '@yesid/ui/cn';
import { TRANSIT_VOCAB } from '$lib/utils/cn-vocab';

export function configureTransitUi(): void {
	configureUi({ vocab: TRANSIT_VOCAB });
}
