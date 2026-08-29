'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The confidentiality gate, as something you can operate.
 *
 * ## Why this is interactive rather than illustrated
 *
 * Every claim this platform makes rests on one structural fact: a listing is two
 * records, and a buyer without a signed NDA can only ever reach one of them.
 * That is hard to believe from a sentence, obvious from a picture, and *felt*
 * from doing it — a visitor who clicks "issue the agreement" and watches exact
 * figures replace ranges has understood the product in about four seconds.
 *
 * This is also the honest answer to "make it interactive and 3D". A floating
 * abstract object would be decoration on a page selling discretion. Operating
 * the actual mechanism is the same craft spent on something that argues.
 *
 * ## The depth is CSS, not WebGL
 *
 * Real perspective, real per-card rotation tracking the pointer, real layered
 * shadows — through `transform: perspective() rotateX() rotateY()`, which is
 * GPU-composited, adds nothing to the bundle, needs no CSP changes, and does not
 * cost a business owner on an iPad a three-second load. A WebGL scene would be
 * heavier, would need shader sources allowed through the policy, and would look
 * like a demo rather than a firm.
 *
 * ## What it does not do
 *
 * Move on its own. The tilt follows a pointer that a person is moving, and stops
 * the moment they stop; nothing here animates unprompted. Ambient motion on a
 * page about confidential transactions reads as a startup landing page, and the
 * people this has to convince are not impressed by movement.
 *
 * Under `prefers-reduced-motion` the tilt is disabled entirely and the state
 * change is instant.
 */

/** Illustrative, and labelled as such on the page. No real business is depicted. */
const SEALED = {
  name: 'Northfield Mechanical Inc',
  where: 'Rochester, NY',
  revenue: '$3,410,000',
  earnings: '$742,000',
  concentration: '41% of revenue',
};

const PUBLIC = {
  name: 'Established HVAC contractor',
  where: 'New York',
  revenue: '$2M – $5M',
  earnings: '$500K – $1M',
  concentration: 'Not disclosed',
};

export function TwoRecordsLive() {
  const [open, setOpen] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [allowMotion, setAllowMotion] = useState(false);
  const frame = useRef<number | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setAllowMotion(!query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  function handlePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!allowMotion || event.pointerType === 'touch') return;

    const element = surface.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    // -1..1 from the centre, so the rotation is symmetric and the maximum is at
    // the edges rather than wherever the pointer happens to enter.
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;

    // Coalesced into a frame: pointermove fires far faster than the screen
    // refreshes, and setting state on every event is how a smooth effect
    // becomes a janky one.
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      setTilt({ x: -py * 9, y: px * 12 });
    });
  }

  const reset = () => setTilt({ x: 0, y: 0 });

  const card = (extraZ: number) =>
    allowMotion
      ? {
          transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) translateZ(${extraZ}px)`,
          transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        }
      : undefined;

  return (
    <div className="space-y-5">
      <div
        ref={surface}
        onPointerMove={handlePointer}
        onPointerLeave={reset}
        style={{ perspective: '1400px' }}
        className="relative"
      >
        <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-[1fr_auto_1fr]">
          <Record
            eyebrow="Public"
            tone="public"
            style={card(0)}
            name={PUBLIC.name}
            where={PUBLIC.where}
            rows={[
              ['Revenue', PUBLIC.revenue],
              ['Earnings', PUBLIC.earnings],
              ['Top customer', PUBLIC.concentration],
            ]}
          />

          <Gate open={open} allowMotion={allowMotion} />

          <Record
            eyebrow={open ? 'Open' : 'Sealed'}
            tone={open ? 'open' : 'sealed'}
            style={card(open ? 14 : 0)}
            name={open ? SEALED.name : '————————'}
            where={open ? SEALED.where : '————'}
            redacted={!open}
            rows={[
              ['Revenue', open ? SEALED.revenue : '██████'],
              ['Earnings', open ? SEALED.earnings : '█████'],
              ['Top customer', open ? SEALED.concentration : '███████'],
            ]}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-pressed={open}
          className="border-copper-600 text-copper-400 hover:bg-copper-600 focus-visible:ring-ring rounded-md border px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] outline-none transition-colors hover:text-stone-50 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
        >
          {open ? 'Revoke the agreement' : 'Sign the confidentiality agreement'}
        </button>
        <p className="text-xs text-stone-400" aria-live="polite">
          {open
            ? 'Signed. The seller can revoke it, and the record seals again.'
            : 'Try it — nothing here is real, and no account is needed.'}
        </p>
      </div>
    </div>
  );
}

function Gate({ open, allowMotion }: { open: boolean; allowMotion: boolean }) {
  return (
    <div className="flex items-center justify-center py-2 sm:flex-col sm:py-0">
      <div className="h-px w-10 bg-slate-600 sm:h-8 sm:w-px" aria-hidden />
      <div
        className={[
          'my-0 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border sm:my-3',
          open
            ? 'border-copper-500 bg-copper-500 text-slate-900'
            : 'border-slate-600 bg-slate-800 text-stone-400',
          allowMotion ? 'transition-colors duration-300' : '',
        ].join(' ')}
      >
        {/* An open shackle when signed, a closed one when not. */}
        <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden>
          <rect x="2" y="8" width="14" height="10" rx="1.5" fill="currentColor" />
          <path
            d={open ? 'M5 8 V5 a4 4 0 0 1 8 0' : 'M5 8 V5 a4 4 0 0 1 8 0 V8'}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            style={allowMotion ? { transition: 'd 300ms ease' } : undefined}
          />
        </svg>
      </div>
      <div className="h-px w-10 bg-slate-600 sm:h-8 sm:w-px" aria-hidden />
    </div>
  );
}

function Record({
  eyebrow,
  tone,
  name,
  where,
  rows,
  redacted,
  style,
}: {
  eyebrow: string;
  tone: 'public' | 'sealed' | 'open';
  name: string;
  where: string;
  rows: [string, string][];
  redacted?: boolean;
  style?: React.CSSProperties;
}) {
  const border =
    tone === 'open'
      ? 'border-copper-600'
      : tone === 'sealed'
        ? 'border-slate-600'
        : 'border-slate-700';

  return (
    <div
      style={style}
      className={[
        'rounded-md border bg-slate-800/70 p-5 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)] backdrop-blur-[1px]',
        border,
      ].join(' ')}
    >
      <p className="text-copper-400 text-2xs font-mono uppercase tracking-[0.18em]">{eyebrow}</p>

      <p
        className={[
          'font-display mt-3 text-base text-stone-50',
          redacted ? 'tracking-[0.1em] text-stone-500' : '',
        ].join(' ')}
      >
        {name}
      </p>
      <p
        className={[
          'mt-0.5 font-mono text-xs',
          redacted ? 'text-stone-600' : 'text-stone-400',
        ].join(' ')}
      >
        {where}
      </p>

      <div className="my-4 h-px bg-slate-600" aria-hidden />

      <dl className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-2xs font-mono uppercase tracking-[0.12em] text-stone-500">
              {label}
            </dt>
            <dd
              className={[
                'font-mono text-sm tabular-nums',
                redacted ? 'select-none text-slate-600' : 'text-stone-50',
              ].join(' ')}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
