// GSAP registration — trimmed for the transit chrome.
//
// The brand chrome uses ONE eager plugin: SplitText (wordmarkHover's action
// contract calls `new SplitText(...)` synchronously, so it can't await a
// dynamic import). GSAP 3.13+ ships the former Club plugins free, so SplitText
// resolves from the standard `gsap` package. Other plugins (ScrollTrigger,
// DrawSVG, …) are deliberately NOT pulled in here — add a lazy loader when a
// scroll/scrub surface actually needs one (keeps the chrome bundle lean).
//
// gsap is bundled for SSR (vite ssr.noExternal) so the subpath ESM resolves;
// the imports are side-effect-safe at module load (gsap defers window access).

import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';

let splitRegistered = false;

/**
 * Synchronous SplitText registration — for wordmarkHover, whose action contract
 * requires `new SplitText(node, ...)` at mount. Idempotent.
 */
export function ensureSplitTextRegistered(): void {
	if (splitRegistered) return;
	gsap.registerPlugin(SplitText);
	splitRegistered = true;
}

export { gsap, SplitText };
