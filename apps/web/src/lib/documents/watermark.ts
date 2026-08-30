import 'server-only';

import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

/**
 * Burning the viewer's identity into the page.
 *
 * ## Why this is server-side and not a CSS overlay
 *
 * An overlay drawn over an embedded PDF is a decoration on the page, not on the
 * document. It disappears the moment anybody opens the file another way, and it
 * would be security theatre — a control that looks like protection and provides
 * none. If a watermark is going to be the reason a seller feels able to release
 * a document, it has to be part of the bytes the viewer receives.
 *
 * ## What it actually achieves
 *
 * Nothing stops a determined copy: a screenshot exists, and a phone pointed at
 * a screen exists. What a watermark does is remove deniability. A leaked page
 * carries the name and email of the account that opened it and the minute it
 * happened, so a leak is attributable — and attribution, rather than
 * prevention, is what stops people passing documents around.
 *
 * Stated plainly because the product says this to users, and it must not
 * overstate it.
 */

export interface WatermarkIdentity {
  name: string | null;
  email: string;
  at: Date;
}

/** Light enough to read the document through, dark enough to survive a print. */
const OPACITY = 0.13;
const ANGLE = 35;

/**
 * Stamps every page of a PDF with who is looking at it.
 *
 * Returns the original bytes unchanged if the file is not a PDF this library
 * can open. An encrypted or malformed document is not worth failing a deal
 * over, and the caller has already decided this person may read it — the access
 * log still records the view, which is the control that does not depend on the
 * file format.
 */
export async function watermarkPdf(
  bytes: Uint8Array,
  identity: WatermarkIdentity,
): Promise<Uint8Array> {
  let pdf: PDFDocument;
  try {
    // `ignoreEncryption` so a lightly protected file still renders rather than
    // throwing. This adds a mark; it does not remove a restriction.
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return bytes;
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const stamp = watermarkText(identity);

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(9, Math.min(16, width / 55));
    const textWidth = font.widthOfTextAtSize(stamp, size);

    /*
     * Tiled rather than one mark in the middle. A single centred stamp is
     * cropped out of a screenshot in one gesture; tiling means any fragment
     * large enough to read the figures also carries the identity.
     */
    const stepX = textWidth + 90;
    const stepY = size * 7;

    for (let y = -height; y < height * 2; y += stepY) {
      for (let x = -width; x < width * 2; x += stepX) {
        page.drawText(stamp, {
          x,
          y,
          size,
          font,
          color: rgb(0.35, 0.35, 0.35),
          opacity: OPACITY,
          rotate: degrees(ANGLE),
        });
      }
    }
  }

  return pdf.save();
}

/**
 * The line that appears on the page.
 *
 * Email rather than name alone: names are not unique, and a name on its own is
 * not enough to identify an account afterwards — which is the entire point. The
 * timestamp is UTC and to the minute; to the second reads as surveillance for
 * no gain, and to the day cannot tell two views apart.
 */
export function watermarkText(identity: WatermarkIdentity): string {
  const when = identity.at.toISOString().slice(0, 16).replace('T', ' ');
  const who = identity.name ? `${identity.name} · ${identity.email}` : identity.email;
  return `CONFIDENTIAL · ${who} · ${when} UTC`;
}

/**
 * Whether this file is one we can actually stamp.
 *
 * Exported so the viewer can say which files carry a mark rather than implying
 * all of them do. A spreadsheet reaches the reader unstamped, and telling them
 * that is better than letting them assume otherwise.
 */
export function isWatermarkable(contentType: string): boolean {
  return contentType === 'application/pdf';
}
