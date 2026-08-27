/**
 * The mechanism, drawn.
 *
 * Every claim this platform makes rests on one structural fact: a listing is two
 * records, and a buyer without a signed NDA can only ever reach one of them. That
 * is difficult to believe from a sentence and obvious from a picture, which is
 * the entire justification for a diagram existing on a marketing page — it shows
 * a mechanism rather than decorating a paragraph.
 *
 * Drawn in SVG rather than exported as an image so it stays sharp at any size,
 * carries real text for a screen reader, and takes its colours from the theme
 * instead of baking one in.
 */
export function TwoRecords() {
  return (
    <svg
      viewBox="0 0 560 260"
      className="h-auto w-full"
      role="img"
      aria-label="A listing is stored as two records. The public teaser shows industry, state and size ranges. The sealed profile holds the company name, exact figures and customers, and opens only to a buyer holding a signed confidentiality agreement."
    >
      {/* ---------------------------------------------------------- teaser */}
      <g>
        <rect
          x="8"
          y="34"
          width="216"
          height="192"
          rx="4"
          className="fill-slate-800 stroke-slate-600"
          strokeWidth="1"
        />
        <text x="26" y="62" className="fill-copper-400 font-mono text-[10px] tracking-[0.16em]">
          PUBLIC
        </text>
        <text x="26" y="92" className="font-display fill-stone-50 text-[15px]">
          Established HVAC
        </text>
        <text x="26" y="112" className="font-display fill-stone-50 text-[15px]">
          contractor
        </text>

        <line x1="26" y1="128" x2="206" y2="128" className="stroke-slate-600" strokeWidth="1" />

        <Field y={144} label="State" value="New York" />
        <Field y={172} label="Revenue" value="$2M – $5M" />
        <Field y={200} label="Earnings" value="$500K – $1M" />
      </g>

      {/* ------------------------------------------------------------ gate */}
      <g>
        <line
          x1="232"
          y1="130"
          x2="264"
          y2="130"
          className="stroke-slate-500"
          strokeWidth="1"
          strokeDasharray="3 4"
        />
        <circle cx="280" cy="130" r="15" className="fill-copper-500" />
        {/* A padlock, small enough to read as an icon rather than an illustration. */}
        <path
          d="M274 129 h12 v10 h-12 z M276.5 129 v-4 a3.5 3.5 0 0 1 7 0 v4"
          className="fill-none stroke-slate-900"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <line
          x1="296"
          y1="130"
          x2="328"
          y2="130"
          className="stroke-slate-500"
          strokeWidth="1"
          strokeDasharray="3 4"
        />
        <text
          x="280"
          y="168"
          textAnchor="middle"
          className="fill-stone-300 font-mono text-[9px] tracking-[0.14em]"
        >
          SIGNED NDA
        </text>
      </g>

      {/* ---------------------------------------------------------- sealed */}
      <g>
        <rect
          x="336"
          y="34"
          width="216"
          height="192"
          rx="4"
          className="stroke-copper-600 fill-slate-900"
          strokeWidth="1"
        />
        <text x="354" y="62" className="fill-copper-400 font-mono text-[10px] tracking-[0.16em]">
          SEALED
        </text>
        <text x="354" y="92" className="font-display fill-stone-50 text-[15px]">
          Northfield Mechanical
        </text>
        <text x="354" y="112" className="fill-stone-400 font-mono text-[11px]">
          Rochester, NY
        </text>

        <line x1="354" y1="128" x2="534" y2="128" className="stroke-slate-600" strokeWidth="1" />

        <Field x={354} y={144} label="Revenue" value="$3,410,000" />
        <Field x={354} y={172} label="Earnings" value="$742,000" />
        <Field x={354} y={200} label="Top customer" value="41% of revenue" />
      </g>

      {/* The line that matters, stated where the picture is doing the arguing. */}
      <text
        x="280"
        y="18"
        textAnchor="middle"
        className="fill-text-muted font-mono text-[9px] tracking-[0.14em]"
      >
        ONE LISTING, TWO RECORDS
      </text>
    </svg>
  );
}

function Field({
  x = 26,
  y,
  label,
  value,
}: {
  x?: number;
  y: number;
  label: string;
  value: string;
}) {
  return (
    <>
      <text x={x} y={y} className="fill-stone-400 font-mono text-[10px]">
        {label}
      </text>
      <text
        x={x}
        y={y + 14}
        className="fill-stone-50 font-mono text-[12px] [font-variant-numeric:tabular-nums]"
      >
        {value}
      </text>
    </>
  );
}
