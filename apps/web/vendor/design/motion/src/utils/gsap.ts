// GSAP registration. ScrollTrigger and SplitText load eagerly (wordmarkHover runs
// `new SplitText(...)` synchronously at mount); every other plugin loads lazily
// through its load*() function, so apps that never call one don't bundle it.

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

let configured = false;
const loadedPlugins = new Set<string>();

/**
 * Register ScrollTrigger and ignore viewport height changes under 25% (the mobile
 * address bar), so pins don't recalculate when browser chrome shows or hides.
 * Idempotent; call it before creating any ScrollTrigger.
 */
export function initScrollTriggerConfig(): void {
	if (configured) return;
	gsap.registerPlugin(ScrollTrigger);
	ScrollTrigger.config({ ignoreMobileResize: true });
	configured = true;
}

/** Register SplitText synchronously, for actions that split text at mount. Idempotent. */
export function ensureSplitTextRegistered(): void {
	if (loadedPlugins.has('SplitText')) return;
	gsap.registerPlugin(SplitText);
	loadedPlugins.add('SplitText');
}

const pendingPlugins = new Map<string, Promise<void>>();

function loadPlugin(name: string, load: () => Promise<object>): Promise<void> {
	let pending = pendingPlugins.get(name);
	if (!pending) {
		pending = load().then((plugin) => gsap.registerPlugin(plugin));
		pending.catch(() => pendingPlugins.delete(name));
		pendingPlugins.set(name, pending);
	}
	return pending;
}

export const loadDrawSVG = () =>
	loadPlugin('DrawSVG', async () => (await import('gsap/DrawSVGPlugin')).DrawSVGPlugin);
export const loadMorphSVG = () =>
	loadPlugin('MorphSVG', async () => (await import('gsap/MorphSVGPlugin')).MorphSVGPlugin);
export const loadCustomEase = () =>
	loadPlugin('CustomEase', async () => (await import('gsap/CustomEase')).CustomEase);

export { gsap, ScrollTrigger, SplitText };
