<section class="boot">
	<p class="label-station">SLICE 9.2 · FONDATION</p>
	<h1>transit<span class="dot">.</span>yesid.dev</h1>
	<p class="lede">
		App-shell foundation. The design system, navigation shell, MapLibre basemap, and the
		<code>/v1</code> data client mount here — feature families A–E (9.3–9.7) build on top.
	</p>
</section>

<style>
	.boot {
		max-width: var(--width-content);
		margin-inline: auto;
		padding: clamp(2rem, 8vw, 6rem) var(--space-page-x, 1.5rem);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	h1 {
		font-family: var(--font-heading);
		font-size: var(--text-display);
		font-weight: 700;
		color: var(--foreground);
		line-height: 1.05;
		letter-spacing: -0.02em;
	}
	.dot {
		color: var(--primary);
	}
	.lede {
		max-width: 48ch;
		color: var(--muted-foreground);
		font-size: var(--text-subheading);
		line-height: 1.6;
	}
	.lede code {
		font-family: var(--font-mono);
		font-size: 0.85em;
		color: var(--accent-text);
	}
</style>
