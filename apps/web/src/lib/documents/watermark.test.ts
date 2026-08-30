import { describe, expect, it } from 'vitest';

import { isWatermarkable, watermarkText } from './watermark';

/**
 * The wording on the stamp, which is the part a person reads and the part that
 * has to hold up if a page ever turns up somewhere it should not.
 */
describe('watermark text', () => {
  const at = new Date('2026-08-30T14:07:42.000Z');

  it('carries an email, because a name does not identify an account', () => {
    const line = watermarkText({ name: 'Dana Reid', email: 'dana@example.com', at });
    expect(line).toContain('dana@example.com');
    expect(line).toContain('Dana Reid');
  });

  it('works when the account has no name on it', () => {
    const line = watermarkText({ name: null, email: 'dana@example.com', at });
    expect(line).toContain('dana@example.com');
    expect(line).not.toContain('null');
  });

  it('stamps to the minute, not the second', () => {
    /*
     * To the second reads as surveillance for no gain; to the day cannot tell
     * two views apart. The minute answers "who had this open" without feeling
     * like a tracking device.
     */
    const line = watermarkText({ name: null, email: 'd@example.com', at });
    expect(line).toContain('2026-08-30 14:07 UTC');
    expect(line).not.toContain(':42');
  });

  it('says what the document is, not only who opened it', () => {
    // The word does work: it is what a recipient sees if a page reaches them
    // second-hand, and it removes "I did not know" as an answer.
    expect(watermarkText({ name: null, email: 'd@example.com', at })).toContain('CONFIDENTIAL');
  });

  it('only claims to stamp what it can actually stamp', () => {
    // A spreadsheet cannot be marked by this path. Saying so in code is what
    // keeps the viewer from implying every file carries one.
    expect(isWatermarkable('application/pdf')).toBe(true);
    expect(isWatermarkable('image/png')).toBe(false);
    expect(isWatermarkable('application/vnd.ms-excel')).toBe(false);
  });
});
