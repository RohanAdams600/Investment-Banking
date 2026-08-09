# Logo creative brief

For a designer or an AI image tool. No final art is committed yet — the codebase carries
placeholder slots (favicon, OG image, app icon) so wiring real art later is a file swap.

## What this mark has to do

Sit in a browser tab next to a Bloomberg terminal and a bank's deal portal without looking
like a consumer app. The audience is business owners selling something they spent thirty
years building, and the institutions buying it. The mark's job is to look like it has been
there a while.

## Direction

**Abstract geometric monogram, or a minimal ascent/bridge/marker motif.**

Explicitly ruled out — these read as stock and undercut the positioning:

- Handshakes, of any abstraction level
- Dollar signs, coins, stacked bars
- Upward arrows through a bar chart
- Skylines and building silhouettes
- Globes, network-of-dots meshes
- Anything inside a rounded-square app-icon frame as part of the mark itself

**Wanted instead:** a form that survives at 16px. If the concept only reads at 200px it is
an illustration, not a mark. Draw it at 16px first and scale up.

If the name is **Cairn**, the obvious and good answer is two or three stacked forms —
offset, not centered, so it reads as placed by a person rather than generated. Resist
making them literal stones.

## Deliverables

1. **Horizontal lockup** — mark + wordmark, for site header and email signature.
2. **Icon-only mark** — square, for favicon, app icon, avatar.

Both in SVG, on a 24×24 grid with a 1.5px nominal stroke so the mark sits naturally
alongside the Lucide icon set already used in the product.

**Use `currentColor` for all strokes and fills.** The product is themed light and dark
from day one; a mark with baked-in hex values will need a second file and eventually
drift. One file that inherits color is the requirement, not a preference.

## Color

- Primary: Deep navy `#0B1220`
- Reversed: near-white `#F8F9FB` on navy
- Accent: champagne gold `#C9A24B` — permitted on **at most one** element of the mark, and
  the mark must still work with it removed. A gold-dependent logo is a logo that breaks in
  every single-color context.
- One-color black and one-color white versions are required, not optional.

## Clear space and minimum size

- **Clear space:** the cap-height of the wordmark on all four sides. Nothing enters it.
- **Minimum size, horizontal lockup:** 120px wide on screen, 1 inch in print.
- **Minimum size, icon:** 16px. Below 24px, ship a simplified variant with detail removed
  rather than letting the full mark blur.

## Do not

- No drop shadows, bevels, or glows
- No gradients on the mark (a gradient is permitted in marketing artwork _behind_ it)
- No stretching, skewing, or non-uniform scaling
- No rotating the mark
- No recoloring outside the palette above
- No placing the mark on a busy photograph without a solid or scrimmed backing
- No outlining the wordmark
- No recreating the wordmark in a different typeface

## Typography for the wordmark

Draw from the display face (Space Grotesk, or the serif alternative if the direction moves
that way — see `docs/brand/brand-guide.md`). Letter-spacing tightened slightly from
default. The wordmark should be converted to outlines in the final SVG so it does not
depend on a font being present.

## Where it gets wired in

| Slot             | Path                                   | Status              |
| ---------------- | -------------------------------------- | ------------------- |
| Favicon          | `apps/web/src/app/icon.svg`            | Placeholder pending |
| Apple touch icon | `apps/web/src/app/apple-icon.png`      | Placeholder pending |
| OG image         | `apps/web/src/app/opengraph-image.tsx` | Placeholder pending |
| Header lockup    | `packages/ui/src/components/logo.tsx`  | Not yet created     |
