'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CircleHelp, Info } from 'lucide-react';
import { AIDisclaimer, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@ib/ui';
import {
  DOCUMENT_LABELS,
  LEGAL_DOCUMENT_KINDS,
  LEGAL_DRAFT_NOTICE,
  fillTemplate,
  reviewDocument,
  type LegalDocumentKind,
} from '@ib/core';

/**
 * Legal document workbench.
 *
 * Two modes, and the split is deliberate.
 *
 * **Review** works today. You paste a draft — from your attorney, the other
 * side, or anywhere — and get a checklist of terms that commonly matter in
 * lower-middle-market deals and appear to be absent. It asks questions; it does
 * not pass judgment.
 *
 * **Draft from template** is blocked until counsel has written and published
 * templates. That is not an oversight. Generating a purchase agreement from
 * placeholder text nobody has reviewed, in a product that also stores the
 * consent record saying the parties accepted it, is how software causes real
 * harm. The empty state says so rather than offering a demo template that
 * someone would inevitably use.
 */

interface DocumentWorkbenchProps {
  /** Published, counsel-approved templates. Empty until they exist. */
  templates: Array<{ id: string; kind: LegalDocumentKind; title: string; version: number }>;
}

export function DocumentWorkbench({ templates }: DocumentWorkbenchProps) {
  const [kind, setKind] = useState<LegalDocumentKind>('loi');
  const [body, setBody] = useState('');

  const review = useMemo(
    () => (body.trim() === '' ? null : reviewDocument(kind, body)),
    [kind, body],
  );

  const availableForKind = templates.filter((t) => t.kind === kind);

  return (
    <div className="space-y-6">
      <AIDisclaimer variant="legal" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your document</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="kind" className="text-text-primary block text-sm font-medium">
                Document type
              </label>
              <select
                id="kind"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as LegalDocumentKind);
                }}
                className="border-border-default bg-surface text-text-primary focus-visible:ring-ring h-9 w-full rounded border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
              >
                {LEGAL_DOCUMENT_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {DOCUMENT_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>

            {availableForKind.length === 0 ? (
              <div className="border-border-subtle bg-surface-sunken/60 flex gap-3 rounded-md border p-3">
                <Info aria-hidden className="text-text-muted mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1 text-xs">
                  <p className="text-text-primary font-medium">
                    No template available for this document type yet
                  </p>
                  <p className="text-text-secondary leading-relaxed">
                    Templates are written and approved by an attorney before they appear here. Until
                    then you can paste a draft below and run it through the checklist.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-text-secondary text-sm font-medium">Start from a template</p>
                {availableForKind.map((template) => (
                  <Button
                    key={template.id}
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full justify-between"
                    onClick={() => {
                      // Placeholders are left visible in the filled body, so an
                      // unfinished document looks unfinished.
                      const { body: filled } = fillTemplate(template.title, {});
                      setBody(filled);
                    }}
                  >
                    <span>{template.title}</span>
                    <Badge variant="neutral">v{template.version}</Badge>
                  </Button>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="body" className="text-text-primary block text-sm font-medium">
                Document text
              </label>
              <textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={20}
                placeholder="Paste the draft here…"
                className="border-border-default bg-surface text-text-primary placeholder:text-text-muted focus-visible:ring-ring w-full resize-y rounded border px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2"
              />
              <p className="text-text-muted text-xs">
                Nothing is saved unless you choose to attach it to a deal.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {review === null ? (
            <Card>
              <CardContent className="text-text-muted py-8 text-center text-sm">
                Paste a document to see what the checklist raises.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Questions to take to your attorney</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {review.findings.length === 0 ? (
                    <p className="text-text-secondary text-sm">
                      The checklist did not flag anything it looks for in a{' '}
                      {DOCUMENT_LABELS[kind].toLowerCase()}.{' '}
                      {/*
                        Said explicitly, because "no findings" is the moment a
                        user is most likely to conclude the document is fine.
                      */}
                      <strong className="text-text-primary">
                        That is not a finding that the document is complete or sound.
                      </strong>{' '}
                      This checks for the presence of common terms, nothing more — it cannot judge
                      whether they say the right thing for your deal.
                    </p>
                  ) : (
                    <ul className="divide-border-subtle divide-y">
                      {review.findings.map((finding, i) => (
                        <li key={i} className="flex gap-3 py-3">
                          {finding.severity === 'blocker' ? (
                            <AlertTriangle
                              aria-hidden
                              className="text-danger mt-0.5 h-4 w-4 shrink-0"
                            />
                          ) : finding.severity === 'attention' ? (
                            <AlertTriangle
                              aria-hidden
                              className="text-warning mt-0.5 h-4 w-4 shrink-0"
                            />
                          ) : (
                            <CircleHelp
                              aria-hidden
                              className="text-text-muted mt-0.5 h-4 w-4 shrink-0"
                            />
                          )}
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-medium">{finding.summary}</p>
                            <p className="text-text-secondary text-xs leading-relaxed">
                              {finding.question}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="py-4">
                  <p className="text-text-secondary text-xs leading-relaxed">
                    {LEGAL_DRAFT_NOTICE}
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
