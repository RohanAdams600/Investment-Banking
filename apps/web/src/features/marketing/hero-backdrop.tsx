/**
 * The texture behind the hero.
 *
 * ## Why a motif rather than a photograph or a gradient
 *
 * A flat near-black rectangle with text on it is honest and completely
 * characterless, and a stock photograph of a handshake is the other failure.
 * What is left is a motif drawn from the thing the company is named for: an
 * ashlar course, dressed stone laid in regular rows with staggered joints. It
 * carries the brand without saying anything, it costs one inline SVG, and it is
 * the sort of mark somebody chose rather than the one a template ships with.
 *
 * ## Drawn as joints, not as blocks
 *
 * Only the mortar lines are drawn — hairlines at a low opacity, staggered every
 * other course the way real coursed masonry is laid. Filled blocks would read
 * as a wall and compete with the headline; the joints read as a surface the
 * text is cut into.
 *
 * ## It fades where the words are
 *
 * A radial mask keeps the pattern strongest at the top-right and gone entirely
 * behind the headline and subhead. Contrast on the text is therefore the
 * measured slate/stone pair, unchanged — nothing here is allowed to eat into
 * it. Also `aria-hidden` and `pointer-events-none`: it is a surface, not
 * content.
 */
export function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/*
        A single warm light, off to the right, sitting under the pattern. It is
        what stops the slab reading as a flat fill — the same trick as a raking
        light across stonework, which is the only way you see that a wall is
        coursed at all.
      */}
      <div
        className="absolute -right-40 -top-40 h-[640px] w-[640px] rounded-full opacity-[0.22] blur-3xl"
        style={{
          // violet-500. Primitives are Tailwind colours, not CSS variables, so
          // a gradient stop has to name the value — the same way the rest of
          // this section names `obsidian-950` and `mist-50` directly.
          background: 'radial-gradient(circle, #8B54DA 0%, transparent 65%)',
        }}
      />

      {/*
        Hidden on a phone. The falloff is placed in fractions of the viewport,
        so on a 390px screen the strong corner lands on top of the headline
        rather than beside it — and a texture that crosses the words is a
        texture that has stopped being a background. The warm light above is
        enough at that size.
      */}
      <svg
        className="absolute inset-0 hidden h-full w-full sm:block"
        preserveAspectRatio="xMidYMid slice"
        role="presentation"
      >
        <defs>
          {/*
            One course of masonry, repeated. 120×34 with the vertical joint at
            the halfway mark and the next course offset by half a block — the
            stagger is what makes it read as stonework instead of graph paper.
          */}
          <pattern id="ashlar-course" width="208" height="96" patternUnits="userSpaceOnUse">
            <g stroke="#FBFAFD" strokeWidth="1" fill="none" opacity="0.42">
              {/* Two bed joints, and the perpends staggered half a block between
                  them — the bond that makes coursed masonry read as masonry
                  rather than as tile. Blocks are roughly 2:1, which is the
                  proportion a quarry actually cuts. */}
              <path d="M0 0.5 H208 M0 48.5 H208" />
              <path d="M104 0.5 V48.5" />
              <path d="M0 48.5 V96 M208 48.5 V96" />
            </g>
          </pattern>

          {/* Strongest at the top right, absent behind the copy. */}
          <radialGradient id="ashlar-falloff" cx="0.95" cy="0.02" r="0.72">
            <stop offset="0%" stopColor="white" stopOpacity="1" />
            <stop offset="45%" stopColor="white" stopOpacity="0.3" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>

          <mask id="ashlar-mask">
            <rect width="100%" height="100%" fill="url(#ashlar-falloff)" />
          </mask>
        </defs>

        <rect width="100%" height="100%" fill="url(#ashlar-course)" mask="url(#ashlar-mask)" />
      </svg>
    </div>
  );
}
