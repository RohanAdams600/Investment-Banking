import { describe, expect, it } from 'vitest';

import {
  CONTACT_KINDS,
  CONTACT_KIND_LABELS,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  buildBoard,
  contactKey,
  countPipeline,
  findDuplicate,
  isOpen,
  type LeadLike,
  type StageLike,
} from './pipeline';

const stage = (over: Partial<StageLike> & { id: string; position: number }): StageLike => ({
  name: `Stage ${over.position}`,
  isTerminal: false,
  isWon: false,
  ...over,
});

const lead = (over: Partial<LeadLike> & { id: string }): LeadLike => ({
  stageId: null,
  status: 'new',
  nextActionAt: null,
  ...over,
});

describe('contactKey', () => {
  it('treats differently-cased addresses as one person', () => {
    expect(contactKey('Dana@Example.com')).toBe(contactKey('dana@example.com'));
  });

  it('trims, because a pasted address carries whitespace', () => {
    expect(contactKey('  dana@example.com  ')).toBe('dana@example.com');
  });

  it('does not apply Gmail dot and plus rules', () => {
    // Those rules are real and specific to Gmail. Applying them everywhere
    // would merge two different people's records at another provider, which is
    // the wrong direction to be wrong in.
    expect(contactKey('sam.smith@fastmail.com')).not.toBe(contactKey('samsmith@fastmail.com'));
    expect(contactKey('sam+deals@fastmail.com')).not.toBe(contactKey('sam@fastmail.com'));
  });

  it('returns null for an absent address rather than an empty key', () => {
    // A phone-only lead off a yard sign is legitimate, and two of them must not
    // collide with each other.
    expect(contactKey(null)).toBeNull();
    expect(contactKey('')).toBeNull();
    expect(contactKey('   ')).toBeNull();
  });

  it('mirrors the unique index, so the warning arrives before the error', () => {
    // `lower(email)` in migration 0024. The database is what refuses; this is
    // so the refusal is not the first the user hears of it.
    expect(contactKey('DANA@EXAMPLE.COM')).toBe('dana@example.com');
  });
});

describe('findDuplicate', () => {
  const existing = [
    { id: 'a', email: 'dana@example.com' },
    { id: 'b', email: null },
    { id: 'c', email: 'ray@example.com' },
  ];

  it('finds the person already in the list', () => {
    expect(findDuplicate(existing, 'Dana@Example.com')?.id).toBe('a');
  });

  it('finds nobody for a new address', () => {
    expect(findDuplicate(existing, 'new@example.com')).toBeNull();
  });

  it('never matches on an absent address', () => {
    expect(findDuplicate(existing, null)).toBeNull();
    expect(findDuplicate(existing, '')).toBeNull();
  });
});

describe('buildBoard', () => {
  const stages = [
    stage({ id: 's1', position: 0 }),
    stage({ id: 's2', position: 1 }),
    stage({ id: 's3', position: 2, isTerminal: true }),
  ];

  it('orders columns by position, not by the order they arrived', () => {
    const shuffled = [stages[2]!, stages[0]!, stages[1]!];
    expect(buildBoard(shuffled, []).map((c) => c.stage.id)).toEqual(['s1', 's2', 's3']);
  });

  it('puts a lead in its own column', () => {
    const board = buildBoard(stages, [lead({ id: 'l1', stageId: 's2' })]);
    expect(board[1]!.leads.map((l) => l.id)).toEqual(['l1']);
  });

  it('puts a lead with no stage in the first column, never nowhere', () => {
    // A lead nobody can see is a lead nobody calls, and "it is in the system"
    // is exactly the failure a board exists to prevent.
    const board = buildBoard(stages, [lead({ id: 'l1' })]);
    expect(board[0]!.leads.map((l) => l.id)).toEqual(['l1']);
  });

  it('rehomes a lead pointing at a stage that has been deleted', () => {
    const board = buildBoard(stages, [lead({ id: 'l1', stageId: 'deleted-stage' })]);
    const placed = board.flatMap((column) => column.leads.map((l) => l.id));
    expect(placed).toEqual(['l1']);
  });

  it('loses nothing, whatever the stage ids say', () => {
    const leads = [
      lead({ id: 'a', stageId: 's1' }),
      lead({ id: 'b', stageId: null }),
      lead({ id: 'c', stageId: 'gone' }),
      lead({ id: 'd', stageId: 's3' }),
    ];
    const placed = buildBoard(stages, leads).flatMap((c) => c.leads.map((l) => l.id));
    expect(placed.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns no columns when the board has not been set up', () => {
    expect(buildBoard([], [lead({ id: 'l1' })])).toEqual([]);
  });
});

describe('countPipeline', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const stages = [
    stage({ id: 'open', position: 0 }),
    stage({ id: 'won', position: 1, isTerminal: true, isWon: true }),
    stage({ id: 'lost', position: 2, isTerminal: true }),
  ];

  it('counts each lead exactly once', () => {
    const leads = [
      lead({ id: 'a', stageId: 'open' }),
      lead({ id: 'b', stageId: 'won' }),
      lead({ id: 'c', stageId: 'lost' }),
    ];
    const counts = countPipeline(stages, leads, now);
    expect(counts.open + counts.won + counts.lost).toBe(3);
  });

  it('treats a converted lead as won even if its stage says otherwise', () => {
    // The status is the fact; the board position is where somebody dragged it.
    const counts = countPipeline(
      stages,
      [lead({ id: 'a', stageId: 'open', status: 'converted' })],
      now,
    );
    expect(counts.won).toBe(1);
    expect(counts.open).toBe(0);
  });

  it('counts an unqualified lead as lost wherever it sits', () => {
    const counts = countPipeline(
      stages,
      [lead({ id: 'a', stageId: 'open', status: 'unqualified' })],
      now,
    );
    expect(counts.lost).toBe(1);
  });

  it('flags a promised call that did not happen', () => {
    const leads = [
      lead({ id: 'a', stageId: 'open', nextActionAt: '2026-06-01T00:00:00Z' }),
      lead({ id: 'b', stageId: 'open', nextActionAt: '2026-07-01T00:00:00Z' }),
    ];
    expect(countPipeline(stages, leads, now).overdue).toBe(1);
  });

  it('does not call a closed lead overdue', () => {
    // Nobody is waiting on a call about a deal that is finished.
    const leads = [lead({ id: 'a', stageId: 'won', nextActionAt: '2026-06-01T00:00:00Z' })];
    expect(countPipeline(stages, leads, now).overdue).toBe(0);
  });

  it('reports zeros for an empty pipeline rather than dividing by it', () => {
    expect(countPipeline(stages, [], now)).toEqual({ open: 0, won: 0, lost: 0, overdue: 0 });
  });
});

describe('labels', () => {
  it('covers every kind, source and status', () => {
    for (const kind of CONTACT_KINDS) expect(CONTACT_KIND_LABELS[kind]).toBeTruthy();
    for (const source of LEAD_SOURCES) expect(LEAD_SOURCE_LABELS[source]).toBeTruthy();
    for (const status of LEAD_STATUSES) expect(LEAD_STATUS_LABELS[status]).toBeTruthy();
  });

  it('says what a status means rather than repeating the enum', () => {
    expect(LEAD_STATUS_LABELS.unqualified).toBe('Not a fit');
    expect(LEAD_STATUS_LABELS.converted).toBe('Became a deal');
  });

  it('agrees with isOpen about which statuses are live work', () => {
    expect(LEAD_STATUSES.filter(isOpen)).toEqual(['new', 'contacted', 'qualified']);
  });
});
