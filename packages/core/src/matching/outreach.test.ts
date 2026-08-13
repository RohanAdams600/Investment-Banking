import { describe, expect, it } from 'vitest';

import { composeOutreach, outreachBlockers, type OutreachInput } from './outreach';

const base: OutreachInput = {
  headline: 'Established HVAC contractor with recurring maintenance contracts',
  industryLabel: 'Home services',
  location: 'New York',
  earningsBand: '$750K – $1M',
  recipientName: 'Dana Okafor',
  senderName: 'Sam Reyes',
  score: 84,
  reasons: [
    { label: 'Industry match', detail: 'This sector is on your list.', points: 30 },
    {
      label: 'Size fits your range',
      detail: 'Revenue and earnings both sit inside your range.',
      points: 27,
    },
    { label: 'Location match', detail: 'This business is in a state you named.', points: 15 },
    { label: 'Industry mismatch', detail: 'Should not appear.', points: 0 },
  ],
  brandName: 'Cairn',
  senderPostalAddress: '100 State Street, Albany, NY 12207',
  unsubscribeUrl: 'https://example.com/unsubscribe/abc',
};

describe('composeOutreach', () => {
  it('addresses the recipient by name', () => {
    expect(composeOutreach(base).body).toContain('Hi Dana Okafor,');
  });

  it('falls back to a neutral greeting with no name', () => {
    const { body } = composeOutreach({ ...base, recipientName: null });
    expect(body).toContain('Hello,');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('null');
  });

  it('names the reasons the buyer actually matched on', () => {
    // This is what makes it personalised rather than a form letter, and it is
    // why the reasons have to be redacted before they reach here.
    const { body } = composeOutreach(base);
    expect(body).toContain('Industry match');
    expect(body).toContain('Size fits your range');
  });

  it('leaves out reasons that scored nothing', () => {
    // Listing a buyer's mismatches back to them is not a reason to reply.
    expect(composeOutreach(base).body).not.toContain('Should not appear');
  });

  it('names at most three reasons', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      label: `Reason ${i}`,
      detail: 'Detail.',
      points: 10 - i,
    }));
    const { body } = composeOutreach({ ...base, reasons: many });

    const named = many.filter((r) => body.includes(r.label));
    expect(named).toHaveLength(3);
  });

  it('labels the score as an estimate, not a recommendation', () => {
    // A percentage presented without that qualifier reads as advice about the
    // largest purchase of somebody's career.
    const { body } = composeOutreach(base);
    expect(body).toContain('84% fit');
    expect(body.toLowerCase()).toContain('not a valuation or a recommendation');
  });

  it('omits the score line when there is no score', () => {
    const { body } = composeOutreach({ ...base, score: undefined });
    expect(body).not.toContain('% fit');
  });

  it('says the full profile requires a signed agreement', () => {
    // The message must not imply the recipient is about to be told who it is.
    const { body } = composeOutreach(base);
    expect(body.toLowerCase()).toContain('confidentiality agreement');
    expect(body.toLowerCase()).toContain('listed anonymously');
  });

  it('carries a postal address and an opt-out', () => {
    const { body } = composeOutreach(base);
    expect(body).toContain('100 State Street, Albany, NY 12207');
    expect(body).toContain('https://example.com/unsubscribe/abc');
  });

  it('never names the business or an exact figure', () => {
    // The input type has no field for either, so this asserts the type is doing
    // its job rather than that the template is careful.
    const { body, subject } = composeOutreach(base);
    const text = `${subject} ${body}`;

    expect(text).not.toContain('LLC');
    expect(text).not.toContain('Holdings');
    // The only figures present are the published band and the score.
    expect(text).toContain('$750K – $1M');
    expect(text).not.toMatch(/\$\d[\d,]{5,}/);
  });

  it('writes a subject that says why without naming the business', () => {
    const { subject } = composeOutreach(base);
    expect(subject).toContain('Home services');
    expect(subject).toContain('New York');
    expect(subject.toLowerCase()).toContain('criteria');
  });

  it('identifies the human sender, not just the platform', () => {
    const { body } = composeOutreach(base);
    expect(body).toContain('Sam Reyes');
    expect(body).toContain('Sent through Cairn');
  });

  it('is deterministic', () => {
    // Same inputs, same words. This is what makes the message reviewable before
    // anyone approves a batch of them.
    expect(composeOutreach(base)).toEqual(composeOutreach(base));
  });

  it('handles a listing with no location or band', () => {
    const { body } = composeOutreach({
      ...base,
      location: undefined,
      earningsBand: undefined,
    });
    expect(body).not.toContain('undefined');
    expect(body).not.toContain(' in .');
  });
});

describe('outreachBlockers', () => {
  it('passes a complete message', () => {
    expect(outreachBlockers(base)).toEqual([]);
  });

  it('flags a missing postal address', () => {
    const blockers = outreachBlockers({ ...base, senderPostalAddress: undefined });
    expect(blockers.join(' ')).toMatch(/postal address/i);
  });

  it('flags a missing opt-out', () => {
    const blockers = outreachBlockers({ ...base, unsubscribeUrl: undefined });
    expect(blockers.join(' ')).toMatch(/opt out/i);
  });

  it('flags an anonymous sender', () => {
    const blockers = outreachBlockers({ ...base, senderName: '   ' });
    expect(blockers.join(' ')).toMatch(/who is sending/i);
  });

  it('reports every problem at once', () => {
    const blockers = outreachBlockers({
      ...base,
      senderPostalAddress: undefined,
      unsubscribeUrl: undefined,
      senderName: '',
    });
    // Fixing one thing and being told about the next is a bad way to find out
    // there were three.
    expect(blockers).toHaveLength(3);
  });
});
