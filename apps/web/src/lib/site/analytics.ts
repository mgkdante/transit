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
		'404',
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
/** Same-origin path the relay route serves; it forwards each event to Plausible once. */
export const ANALYTICS_ENDPOINT = '/relay/e';

let analytics: Analytics<AnalyticsEvent, Props> | undefined;
// Child components mount before the root layout starts analytics, so early events wait here.
let pending: [AnalyticsEvent, AnalyticsEventProps | undefined][] = [];

export function trackEvent(name: AnalyticsEvent, props?: AnalyticsEventProps): void {
	if (analytics) analytics.trackEvent(name, props);
	else pending = [...pending, [name, props]];
}

export function outboundEvent({
	hostname,
	pathname,
}: Pick<URL, 'hostname' | 'pathname'>): AnalyticsEvent | undefined {
	if (hostname === 'yesid.dev') return 'Portfolio Click';
	if (hostname === 'github.com' && /^\/yesid-dev\/[^/]+/.test(pathname)) return 'Repo Click';
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
 * Starts Plausible (pageviews and the events above, sent through Transit's own relay route) and
 * the Cloudflare Web Analytics beacon. Both stay off unless the page is served from `domain`, so
 * local, preview and fork hosts send nothing. Only the first call per page load starts anything.
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
	if (analytics) return;
	const started = createAnalytics(preset, {
		domain,
		endpoint: ANALYTICS_ENDPOINT,
		context: () => context() as AnalyticsPropValues<Props>,
	});
	analytics = started;
	for (const [name, props] of pending) started.trackEvent(name, props);
	pending = [];
	if (!servedFrom(domain)) return;
	document.addEventListener('click', onOutboundClick, { capture: true });
	document.addEventListener('auxclick', onOutboundClick, { capture: true });
	if (beaconToken && BEACON_TOKEN.test(beaconToken)) loadCloudflareBeacon(beaconToken);
}
