<script lang="ts">
	import { QuietModeButton as UiQuietModeButton, type QuietModeButtonCopy } from '@yesid/ui/brand';
	import { getLocale, type Locale } from '$lib/i18n';

	let { class: className = '' }: { class?: string } = $props();

	const COPY: Record<Locale, QuietModeButtonCopy> = {
		en: {
			collapse: 'Collapse all',
			expand: 'Expand all',
			collapseTitle: 'Collapse all sections on this page',
			expandTitle: 'Expand all sections on this page',
			remember: 'Always start collapsed',
			forget: "Don't start collapsed",
		},
		fr: {
			collapse: 'Tout replier',
			expand: 'Tout déplier',
			collapseTitle: 'Replier toutes les sections de la page',
			expandTitle: 'Déplier toutes les sections de la page',
			remember: 'Toujours replier',
			forget: 'Ne plus replier',
		},
	};
	const locale: Locale = getLocale();
	const t = COPY[locale];
</script>

<UiQuietModeButton copy={t} activeEffect="none" class={className} />
