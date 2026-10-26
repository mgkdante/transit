/**
 * scrollChain — Universal Svelte action for natural scroll chaining with Lenis.
 *
 * Replaces all `data-lenis-prevent` attributes. Makes nested scrollable containers
 * behave like they do on any normal website: scroll inside the container when there's
 * room, chain to the parent (Lenis page scroll) when at a boundary.
 *
 * Handles vertical, horizontal, and dual-overflow containers automatically.
 *
 * How it works:
 * - Vertical overflow: toggles `data-lenis-prevent` at top/bottom boundaries
 * - Horizontal-only overflow: no `data-lenis-prevent` needed — Lenis only captures
 *   vertical scroll, browser handles horizontal natively
 * - No overflow: passes all events to Lenis
 *
 * Timing: Our handler fires on the element (closer to target), then the event
 * bubbles to document where Lenis catches it. By the time Lenis checks for
 * `data-lenis-prevent`, we've already toggled it.
 *
 * Glide cancel (go2 nested-scroll fix): toggling the attribute only stops Lenis
 * from CONSUMING the next event — it does not stop an ease already in flight.
 * After a boundary handoff (card bottoms out → wheel chains to Lenis → 1.2s
 * eased page glide), reversing the wheel over the card re-claimed the events
 * for native card scroll, but the page kept gliding underneath for up to a
 * second AND Lenis's targetScroll stayed parked far away — so "scroll up over
 * a scrolled card" felt dead. Whenever the card claims a wheel event while
 * Lenis is mid-ease, freeze the page exactly where it is (public API:
 * scrollTo current position with immediate:true stops the internal animation
 * and re-syncs targetScroll to the actual position).
 */
import { getLenis } from '../utils/lenis.js';

export function scrollChain(node: HTMLElement) {
	function hasVerticalOverflow(): boolean {
		return node.scrollHeight > node.clientHeight + 1;
	}

	function cancelLenisGlide(): void {
		const lenis = getLenis();
		if (lenis && lenis.isScrolling === 'smooth') {
			lenis.scrollTo(lenis.scroll, { immediate: true, programmatic: true });
		}
	}

	function handleWheel(e: WheelEvent) {
		// No vertical overflow — let Lenis handle all vertical scroll.
		// Horizontal scroll (if any) is handled by the browser natively.
		if (!hasVerticalOverflow()) {
			node.removeAttribute('data-lenis-prevent');
			return;
		}

		const { scrollTop, scrollHeight, clientHeight } = node;
		const atTop = scrollTop <= 1;
		const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
		const scrollingDown = e.deltaY > 0;
		const scrollingUp = e.deltaY < 0;

		// Primarily horizontal gesture (trackpad swipe) — let it through to Lenis
		if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
			node.removeAttribute('data-lenis-prevent');
			return;
		}

		if ((atBottom && scrollingDown) || (atTop && scrollingUp)) {
			// At vertical boundary, scrolling further — chain to Lenis
			node.removeAttribute('data-lenis-prevent');
		} else {
			// Inside scrollable area — container owns the scroll
			if (!node.hasAttribute('data-lenis-prevent')) {
				node.setAttribute('data-lenis-prevent', '');
			}
			// The card owns this event: any in-flight Lenis ease must stop NOW,
			// or the page glides under the card while it tries to unwind.
			cancelLenisGlide();
		}
	}

	// Start with data-lenis-prevent so the container scrolls normally
	if (hasVerticalOverflow()) {
		node.setAttribute('data-lenis-prevent', '');
	}

	node.addEventListener('wheel', handleWheel, { passive: true });

	return {
		destroy() {
			node.removeEventListener('wheel', handleWheel);
			node.removeAttribute('data-lenis-prevent');
		}
	};
}
