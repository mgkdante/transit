<script lang="ts">
	import type { Locale } from '#lib/i18n/index.ts';
	import { HOME_INVITE_LINKS, homeInviteCopy } from './homePulse.copy';

	let { locale }: { readonly locale: Locale } = $props();
	const t = $derived(homeInviteCopy[locale]);
</script>

<section class="home-invite" data-slot="home-invite" aria-labelledby="home-invite-title">
	<h2 id="home-invite-title">{t.title}</h2>
	<p>{t.body}</p>
	<div class="invite-actions">
		<a href={HOME_INVITE_LINKS.contribute} rel="noopener">{t.contribute} ↗</a>
		<a href={HOME_INVITE_LINKS.code} rel="noopener">{t.code} ↗</a>
		<a href={HOME_INVITE_LINKS.contact[locale]} rel="noopener">{t.contact} ↗</a>
	</div>
	<p class="invite-support" data-slot="home-support">{t.support}</p>
</section>

<style>
	.home-invite {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding-top: 2rem;
		border-top: 1px solid var(--border-brand);
	}
	.home-invite h2 {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-heading);
		font-weight: 800;
		letter-spacing: var(--tracking-tight);
	}
	.home-invite p {
		max-width: var(--measure-body);
		margin: 0;
		line-height: 1.65;
		color: var(--secondary-foreground);
	}
	.invite-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
	}
	.invite-actions a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: var(--accent-text);
		font-family: var(--font-mono);
	}
	.invite-actions a:focus-visible {
		outline: 2px solid var(--accent-text);
		outline-offset: 2px;
	}
	.home-invite .invite-support {
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
</style>
