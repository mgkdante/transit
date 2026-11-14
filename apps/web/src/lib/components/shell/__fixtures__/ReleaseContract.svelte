<script lang="ts">
	import { CollapsibleSection, LanguageToggle } from '@yesid/ui/brand';
	import { Button } from '@yesid/ui/button';
</script>

<CollapsibleSection title="Reading">
	{#snippet summary()}<p>Finding, period and hedge remain readable.</p>{/snippet}
	<p>Read this body without closing it.</p>
	<Button>Section action</Button>
</CollapsibleSection>
<LanguageToggle
	locale="fr"
	locales={['fr', 'en']}
	href={(locale) => `/${locale}`}
	label="Language"
	names={{ en: 'English', fr: 'Français' }}
/>
