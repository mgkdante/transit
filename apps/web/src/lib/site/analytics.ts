import { createAnalytics, type Analytics } from '@yesid/analytics/client';
import {
	defineAnalyticsPreset,
	type AnalyticsEventName,
	type AnalyticsPropValues,
} from '@yesid/analytics/config';

const preset = defineAnalyticsPreset({
	events: [
		'Search Result',
		'Locate Me',
		'Address Pick',
		'Nearby Stop',
		'Receipt Copy',
		'Portfolio Click',
		'Repo Click',
	],
	props: {
		locale: ['en', 'fr'],
		provider: ['stm', 'octranspo'],
		kind: ['route', 'stop', 'vehicle', 'address'],
		placement: ['menu', 'footer', 'page'],
	},
});

export type AnalyticsEvent = AnalyticsEventName<typeof preset>;
type Props = NonNullable<(typeof preset)['props']>;
export type AnalyticsEventProps = AnalyticsPropValues<Pick<Props, 'kind' | 'placement'>>;

/** Read on every pageview and event; values the preset does not allow are dropped. */
export interface AnalyticsContext {
	readonly locale: string;
	readonly provider: string;
}

const BEACON_TOKEN = /^[0-9a-f]{32}$/i;

let analytics: Analytics<AnalyticsEvent, Props> = { trackEvent() {} };

export function trackEvent(name: AnalyticsEvent, props?: AnalyticsEventProps): void {
	analytics.trackEvent(name, props);
}

export function outboundEvent({
	hostname,
	pathname,
}: Pick<URL, 'hostname' | 'pathname'>): AnalyticsEvent | undefined {
	if (hostname === 'yesid.dev') return 'Portfolio Click';
	if (hostname === 'github.com' && pathname.startsWith('/mgkdante/')) return 'Repo Click';
	return undefined;
}

function linkPlacement(link: Element): NonNullable<AnalyticsEventProps['placement']> {
	if (link.closest('footer')) return 'footer';
	if (link.closest('header, nav, [role="dialog"]')) return 'menu';
	return 'page';
}

function servedFrom(domain: string | undefined): domain is string {
	const hostname = globalThis.location?.hostname;
	return !!domain && !!hostname && (hostname === domain || hostname.endsWith(`.${domain}`));
}

function loadCloudflareBeacon(token: string): void {
	const script = document.createElement('script');
	script.type = 'module';
	script.src = `https://static.cloudflareinsights.com/beacon.min.js?token=${token}`;
	document.head.append(script);
}

function onOutboundClick(event: MouseEvent): void {
	if (event.type === 'auxclick' && event.button !== 1) return;
	const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
	const name = link instanceof HTMLAnchorElement ? outboundEvent(link) : undefined;
	if (link && name) trackEvent(name, { placement: linkPlacement(link) });
}

/**
 * Starts Plausible (pageviews and the events above) and the Cloudflare Web Analytics beacon.
 * Both stay off unless the page is served from `domain`, so local, preview and fork hosts send
 * nothing. Call once per page load in the browser.
 */
export function startAnalytics({
	domain,
	beaconToken,
	context,
}: {
	domain: string | undefined;
	beaconToken: string | undefined;
	context: () => AnalyticsContext;
}): void {
	analytics = createAnalytics(preset, {
		domain,
		context: () => context() as AnalyticsPropValues<Props>,
	});
	if (!servedFrom(domain)) return;
	document.addEventListener('click', onOutboundClick, { capture: true });
	document.addEventListener('auxclick', onOutboundClick, { capture: true });
	if (beaconToken && BEACON_TOKEN.test(beaconToken)) loadCloudflareBeacon(beaconToken);
}
