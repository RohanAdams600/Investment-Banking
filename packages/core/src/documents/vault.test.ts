import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_VISIBILITIES,
  DOCUMENT_VISIBILITY_HINTS,
  DOCUMENT_VISIBILITY_LABELS,
  DocumentRejected,
  assertAcceptable,
  documentKey,
  formatBytes,
  safeFileName,
  visibilityWarning,
} from './vault';

const DEAL = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';

describe('safeFileName', () => {
  it('leaves an ordinary name alone', () => {
    expect(safeFileName('FY2025 tax return.pdf')).toBe('FY2025 tax return.pdf');
  });

  it('cannot produce a name that moves the path segment boundary', () => {
    // The object key is `<deal>/<document>/<name>` and the storage policy reads
    // the second segment. A slash in the name shifts which document the object
    // claims to belong to, so the policy would check the wrong one.
    for (const attack of [
      '../../other-deal/x.pdf',
      'a/b.pdf',
      'a\\b.pdf',
      '/etc/passwd',
      '..\\..\\x.pdf',
    ]) {
      expect(safeFileName(attack)).not.toContain('/');
      expect(safeFileName(attack)).not.toContain('\\');
    }
  });

  it('keeps the number of segments in a key at three, whatever the name', () => {
    const key = documentKey(DEAL, DOC, '../../elsewhere/secret.pdf');
    expect(key.split('/')).toHaveLength(3);
    expect(key.split('/')[1]).toBe(DOC);
  });

  it('strips control characters and null bytes', () => {
    expect(safeFileName('re\u0000port.pdf')).toBe('report.pdf');
    expect(safeFileName('report\u007f.pdf')).toBe('report.pdf');
  });

  it('refuses a name that is only dots', () => {
    expect(() => safeFileName('..')).toThrow(DocumentRejected);
    expect(() => safeFileName('.')).toThrow(DocumentRejected);
  });

  it('refuses a name that is empty once cleaned', () => {
    expect(() => safeFileName('   ')).toThrow(DocumentRejected);
    expect(() => safeFileName('\u0000\u0001')).toThrow(DocumentRejected);
  });

  it('truncates rather than rejecting a very long name', () => {
    // A 400-character name is somebody's export, not an attack. Losing the tail
    // is better than losing the upload.
    const long = `${'a'.repeat(400)}.pdf`;
    expect(safeFileName(long)).toHaveLength(255);
  });
});

describe('assertAcceptable', () => {
  const pdf = { type: 'application/pdf', size: 1024, name: 'a.pdf' };

  it('accepts what the bucket accepts', () => {
    expect(() => assertAcceptable(pdf)).not.toThrow();
  });

  it('refuses a type the bucket would reject anyway', () => {
    // Refused here so nobody watches an upload run and then fail at the end.
    expect(() => assertAcceptable({ ...pdf, type: 'application/x-msdownload' })).toThrow(
      DocumentRejected,
    );
  });

  it('refuses an oversize file', () => {
    expect(() => assertAcceptable({ ...pdf, size: 200 * 1024 * 1024 })).toThrow(/over 100 MB/);
  });

  it('refuses an empty file', () => {
    expect(() => assertAcceptable({ ...pdf, size: 0 })).toThrow(/empty/);
  });

  it('refuses a file whose name cannot be made safe', () => {
    expect(() => assertAcceptable({ ...pdf, name: '..' })).toThrow(DocumentRejected);
  });
});

describe('visibilityWarning', () => {
  it('warns before opening tax returns to the whole room', () => {
    const warning = visibilityWarning('tax_return', 'deal');
    expect(warning).toMatch(/anybody added later/i);
  });

  it('says nothing about a marketing deck', () => {
    expect(visibilityWarning('other', 'deal')).toBeNull();
    expect(visibilityWarning('operational', 'deal')).toBeNull();
  });

  it('says nothing when the document is not being opened to the room', () => {
    expect(visibilityWarning('tax_return', 'restricted')).toBeNull();
    expect(visibilityWarning('tax_return', 'private')).toBeNull();
  });

  it('never blocks — it returns a sentence or nothing', () => {
    // The seller owns the decision. This exists to make sure they made it on
    // purpose, not to overrule them.
    for (const category of DOCUMENT_CATEGORIES) {
      for (const visibility of DOCUMENT_VISIBILITIES) {
        const result = visibilityWarning(category, visibility);
        expect(result === null || typeof result === 'string').toBe(true);
      }
    }
  });
});

describe('labels', () => {
  it('covers every category and every visibility', () => {
    for (const category of DOCUMENT_CATEGORIES) {
      expect(DOCUMENT_CATEGORY_LABELS[category]).toBeTruthy();
    }
    for (const visibility of DOCUMENT_VISIBILITIES) {
      expect(DOCUMENT_VISIBILITY_LABELS[visibility]).toBeTruthy();
      expect(DOCUMENT_VISIBILITY_HINTS[visibility]).toBeTruthy();
    }
  });

  it('describes each level as who can see it, not as a status word', () => {
    // "Restricted" on a radio button tells somebody nothing. Every label has to
    // name people, because choosing wrong here is how a tax return reaches the
    // wrong bidder.
    for (const visibility of DOCUMENT_VISIBILITIES) {
      expect(DOCUMENT_VISIBILITY_LABELS[visibility]).toMatch(
        /my side|people|everyone|anyone|room/i,
      );
    }
  });
});

describe('formatBytes', () => {
  it('reads the way a person would say it', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
