import type { Token, TokenTree } from '../types.ts';
import { serializeYaml } from '../serialize.ts';
import { isLeaf, isClampToken } from '../parse.ts';

export interface DesignMdOptions {
  components?: readonly string[];
  brandComponents?: readonly string[];
  primitiveSubpaths?: readonly string[];
}

function yamlMap(tree: TokenTree, indent: number, transformKey?: (k: string) => string): string {
  const lines: string[] = [];
  const pad = ' '.repeat(indent);
  for (const [k, v] of Object.entries(tree)) {
    if (k.startsWith('$')) continue;
    const outKey = transformKey ? transformKey(k) : k;
    if (isLeaf(v)) {
      lines.push(`${pad}${outKey}: ${serializeYaml(v)}`);
    } else {
      lines.push(`${pad}${outKey}:`);
      lines.push(yamlMap(v as TokenTree, indent + 2, transformKey));
    }
  }
  return lines.join('\n');
}

/**
 * Emit flat color map: brand colors + dark theme colors.
 * The design.md spec requires colors to be flat hex values at `colors.<name>`.
 * We emit brand colors first (primary, accent, etc.), then dark semantic tokens
 * (background, foreground, etc.). Light theme overrides are prose, not tokens.
 */
function flatColorMap(colorTree: TokenTree): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  // brand colors
  const brand = colorTree.brand as TokenTree | undefined;
  if (brand) {
    for (const [k, v] of Object.entries(brand)) {
      if (k.startsWith('$') || !isLeaf(v)) continue;
      // Only emit hex color values (skip rgb channels and other non-hex)
      if (typeof v.$value === 'string' && v.$value.startsWith('#')) {
        lines.push(`  ${k}: ${serializeYaml(v)}`);
        seen.add(k);
      }
    }
  }
  // dark theme semantic colors (source of truth for dark-first design)
  const dark = colorTree.dark as TokenTree | undefined;
  if (dark) {
    for (const [k, v] of Object.entries(dark)) {
      if (k.startsWith('$') || !isLeaf(v) || seen.has(k)) continue; // skip brand re-pins (GO-W2.2)
      if (typeof v.$value === 'string' && v.$value.startsWith('#')) {
        lines.push(`  ${k}: ${serializeYaml(v)}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Emit typography fontSize as a valid spec dimension (px/em/rem).
 * For clamp() tokens, we use the max value (large-viewport design intent).
 * The spec does not accept clamp() expressions as dimension values.
 */
function typographyFontSize(v: Token): string {
  if (isClampToken(v)) {
    // Use max value — the largest design-intent size, comprehensible to agents
    return `"${v.$value.max}"`;
  }
  return serializeYaml(v);
}

export function generateDesignMd(tree: TokenTree, opts: DesignMdOptions = {}): string {
  const colors = tree.color as TokenTree;
  const text = tree.text as TokenTree;
  const radius = tree.radius as TokenTree;
  const space = tree.space as TokenTree;

  // Typography: each text-* token becomes { fontSize: <dimension> }.
  // fontSize uses the max of any clamp() value — a valid spec dimension.
  const typographyLines: string[] = [];
  for (const [k, v] of Object.entries(text)) {
    if (isLeaf(v)) {
      typographyLines.push(`  ${k}:`);
      typographyLines.push(`    fontSize: ${typographyFontSize(v)}`);
    }
  }

  const components = opts.components ?? opts.brandComponents ?? [];
  const componentsBlock = components.length
    ? components.map((component) => `  ${component}: {}`).join('\n')
    : '  # see Notion design system page';
  const brandComponents = opts.brandComponents ?? [];
  const primitiveSubpaths = opts.primitiveSubpaths ?? [];
  const componentInventory = brandComponents.length || primitiveSubpaths.length
    ? `See \`@yesid/ui/brand\` (${brandComponents.length} components: ${brandComponents.map((name) => `\`${name}\``).join(', ')}) and
${primitiveSubpaths.length} primitive subpaths (${primitiveSubpaths.map((name) => `\`@yesid/ui/${name}\``).join(', ')}).`
    : 'See the public `@yesid/ui/brand` export and the `@yesid/ui/*` primitive subpath exports.';

  return `---
version: alpha
name: yesid.dev
description: Digital infrastructure that moves. Edge-to-edge, dark-first, four-color infrastructure doctrine (orange signage · yellow wayfinding · reflective white · structural black), motion-with-intent.

# GENERATED FROM packages/tokens/tokens.json — DO NOT EDIT
# Run \`bun run tokens:build\` to regenerate.

colors:
${flatColorMap(colors)}

typography:
${typographyLines.join('\n')}

rounded:
${yamlMap(radius, 2)}

spacing:
${yamlMap(space, 2, (k) => `"${k}"`)}

components:
${componentsBlock}
---

## Overview

yesid.dev is a freelance digital-infrastructure brand. The design language is edge-to-edge,
dark-first, governed by the four-color infrastructure doctrine below. Every visual decision
traces back to one of five principles: edge-to-edge layout, dark-first surfaces, one-orange
interactivity (orange is the clickable hue — with a single doctrinal exception: yellow
conversion buttons, see Colors), motion-with-intent, no fluff.
Full narrative and implementation rules: Notion → Business → Brand.

## Colors

**THE FOUR-COLOR INFRASTRUCTURE DOCTRINE** (constitutional). Real infrastructure speaks four
colors — orange signage, yellow hazard stripes (with black), reflective white, black tape and
structure. Each holds a named role; every component usage maps to exactly one:

- **ORANGE — interactive/signage** (\`primary\` \`#E07800\`, light \`#A05500\`): links, buttons,
  CTAs, focus rings, active/hover states, signage accents. The clickable hue for everything
  except conversion (below).
- **YELLOW — wayfinding & hazard & highlight** (\`accent\` \`#FFB627\` as surface/art;
  \`accent-text\` as AA text, light \`#815D00\`; \`line-amber\`; \`accent-surface\`): section
  labels/overlines (\`.label-station\`), departure-board and status readouts, metric/number
  callouts, data-viz/diagram amber, selected/highlight states, hazard tape. Round 5c —
  THE YELLOW-CONVERSION RULE: yellow holds exactly ONE clickable job, "talk to Yesid"
  conversion buttons (contact submit, hero contact, about send, closer CTA) drawn as the
  theme-invariant signage pair (\`accent\` \`#FFB627\` ground / \`signage-bg\` \`#1C1814\` ink,
  ~10:1, hover \`accent-hover\`), at most one per view. Every other yellow stays unclickable.
- **WHITE — reflective** (\`reflective\` \`#F5F5F0\`, theme-invariant; dark \`foreground\`):
  key headline words on dark, catch-lights (\`edge-highlight\`), white-core métro dots and
  reflective chips over guaranteed-dark grounds.
- **BLACK — tape/structure** (\`hazard-b\` / \`signage-bg\` \`#1C1814\`; light \`border-strong\`
  joins the family): hazard stripe pairing, signage chip grounds, light-mode strong
  structural rules drawn as black tape on paper. Dark mode's deep board IS the black voice.

Semantic tokens (\`background\`, \`foreground\`, \`card\`, \`muted\`, etc.) carry theme-switching
responsibility. Contrast verified on dark first, then light — all pairs script-computed.

## Typography

Inter Variable for headings + body; JetBrains Mono Variable for code, terminals, mono labels.
Self-hosted (no Google Fonts CDN). Type scale uses \`clamp()\` for fluid sizing across breakpoints.
Hard floors: body ≥ 16px, mono ≥ 13px, labels ≥ 12px, micro for chrome only.

## Layout

Four CSS Grid recipes: Full-Bleed · Contained · Content+Sidebars · Edge-Title-Grid. Container
widths cap at \`64rem\` (content) / \`72rem\` (wide). Page gutters scale via \`--space-page-x\`.
Section spacing scales via \`--space-section-y\`. Detailed recipes: Notion → Business → Brand.

## Elevation & Depth

Shadow tokens use \`color-mix(in srgb, var(--primary) N%, transparent)\` for brand-connected
glows. Six tiers: \`glow-sm\`, \`glow-md\`, \`glow-lg\`, \`card\`, \`section\`, \`nav\`. No raw
\`box-shadow\` in components.

## Shapes

Five radius tokens: \`sm\` (4px), \`md\` (8px, default), \`lg\` (12px), \`xl\` (16px), \`pill\` (9999px).
Borders use semantic tokens (\`border\`, \`border-subtle\`, \`border-strong\`).

## Components

${componentInventory} Design-system documentation:
Notion → Business → Brand.

## Do's and Don'ts

**Do**

- Reference tokens via \`var(--token)\` or Tailwind utilities (\`bg-primary\`, \`text-foreground\`).
- Use the 4 CSS Grid recipes; pages own their grids in scoped CSS.
- Respect \`prefers-reduced-motion\` on every animation.

**Don't**

- Hardcode hex colors in components.
- Use arbitrary Tailwind values (\`text-[14px]\`, \`p-[22px]\`) — use the scale or a token.
- Use \`vh\` on mobile; use \`dvh\`/\`svh\`/\`lvh\`.
- Add motion that doesn't serve wayfinding, feedback, or emphasis.
`;
}
