'use client';

import { useActionState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { INDUSTRY_KEYS, INDUSTRY_PROFILES, type IndustryKey } from '@ib/core';
import { Button } from '@ib/ui';

import { saveFirmProfile, setProfilePublished, type ProfileState } from './actions';

const initial: ProfileState = { error: null, message: null };

export interface ProfileDraft {
  headline: string;
  about: string;
  website: string;
  contactEmail: string;
  establishedYear: string;
  industries: string[];
  jurisdictions: string[];
  isPublished: boolean;
  slug: string | null;
}

/**
 * The form a firm fills in to appear in the directory.
 *
 * ## Publishing is a separate control, above the form
 *
 * Not a checkbox inside it. A checkbox is something people tick while filling
 * in fields and forget they ticked; this is the moment their firm's name
 * becomes a public page, and it should feel like a decision rather than a
 * field. It also has to be reversible in one click from wherever they are,
 * which a form field buried under nine inputs is not.
 *
 * ## The fields are what a broker already has
 *
 * A headline, a paragraph, the sectors and states they work in, their own site
 * and a year. Nothing asks for a deal count or a success rate, because the
 * platform cannot verify either and would end up publishing an unverifiable
 * number under its own name.
 */
export function FirmProfileForm({
  firmId,
  firmName,
  draft,
}: {
  firmId: string;
  firmName: string;
  draft: ProfileDraft;
}) {
  const [saveState, saveAction, saving] = useActionState(saveFirmProfile, initial);
  const [pubState, pubAction, publishing] = useActionState(setProfilePublished, initial);

  const message = pubState.message ?? saveState.message;
  const error = pubState.error ?? saveState.error;

  return (
    <div className="space-y-8">
      {/* The switch, and what it currently means. */}
      <div className="border-border-default bg-surface flex flex-wrap items-center justify-between gap-4 rounded-md border p-5">
        <div className="flex items-start gap-3">
          {draft.isPublished ? (
            <Eye className="text-accent mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          ) : (
            <EyeOff className="text-text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          )}
          <div className="space-y-1">
            <p className="font-medium">
              {draft.isPublished ? 'Listed in the directory' : 'Not listed'}
            </p>
            <p className="text-text-muted max-w-md text-sm leading-relaxed">
              {draft.isPublished ? (
                <>
                  Anyone can find {firmName} at{' '}
                  <code className="text-text-secondary">/brokers/{draft.slug}</code>. Hide it and
                  the page returns nothing immediately.
                </>
              ) : (
                <>
                  Nothing about {firmName} is public. Fill in what you want people to see, then
                  publish — you can hide it again at any time.
                </>
              )}
            </p>
          </div>
        </div>

        <form action={pubAction}>
          <input type="hidden" name="firmId" value={firmId} />
          <input type="hidden" name="publish" value={draft.isPublished ? 'false' : 'true'} />
          <Button
            type="submit"
            variant={draft.isPublished ? 'secondary' : 'primary'}
            disabled={publishing}
          >
            {publishing ? 'Saving…' : draft.isPublished ? 'Hide my profile' : 'Publish my profile'}
          </Button>
        </form>
      </div>

      <form action={saveAction} className="space-y-6">
        <input type="hidden" name="firmId" value={firmId} />

        <Field
          id="headline"
          label="One line about the firm"
          hint="Shown under your name in the directory. What you do and where."
        >
          <input
            id="headline"
            name="headline"
            defaultValue={draft.headline}
            maxLength={120}
            placeholder="Lower-middle-market brokerage across Ohio and Kentucky"
            className="border-border-default bg-canvas focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
          />
        </Field>

        <Field
          id="about"
          label="About the firm"
          hint="A few paragraphs in your own words. It appears exactly as you write it — no formatting is applied."
        >
          <textarea
            id="about"
            name="about"
            defaultValue={draft.about}
            maxLength={2000}
            rows={7}
            className="border-border-default bg-canvas focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm leading-relaxed outline-none focus-visible:ring-2"
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Sectors you work in</legend>
          <p className="text-text-muted text-xs">Up to eight.</p>
          <div className="grid gap-2 pt-1 sm:grid-cols-2">
            {INDUSTRY_KEYS.map((key) => (
              <label key={key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="industries"
                  value={key}
                  defaultChecked={draft.industries.includes(key)}
                  className="mt-1"
                />
                <span>{INDUSTRY_PROFILES[key as IndustryKey].label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field
          id="jurisdictions"
          label="States you cover"
          hint="Two-letter codes, prefixed US- and separated by commas. For example: US-OH, US-KY, US-IN"
        >
          {/*
            Text rather than fifty checkboxes. A broker covering three states
            types them in seconds; a list of fifty is a scroll on every visit
            for everybody. The action filters the values against a pattern, so
            anything malformed is dropped rather than stored.
          */}
          <input
            id="jurisdictions"
            name="jurisdictions-raw"
            defaultValue={draft.jurisdictions.join(', ')}
            placeholder="US-OH, US-KY"
            className="border-border-default bg-canvas focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
            onChange={(event) => {
              const host = event.currentTarget.form;
              if (!host) return;
              host.querySelectorAll('input[name="jurisdictions"]').forEach((node) => node.remove());
              for (const code of event.currentTarget.value.split(',')) {
                const value = code.trim().toUpperCase();
                if (!value) continue;
                const hidden = document.createElement('input');
                hidden.type = 'hidden';
                hidden.name = 'jurisdictions';
                hidden.value = value;
                host.appendChild(hidden);
              }
            }}
          />
          {draft.jurisdictions.map((code) => (
            <input key={code} type="hidden" name="jurisdictions" value={code} />
          ))}
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field id="website" label="Your website" hint="Must start with https://">
            <input
              id="website"
              name="website"
              type="url"
              defaultValue={draft.website}
              placeholder="https://example.com"
              className="border-border-default bg-canvas focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
            />
          </Field>

          <Field id="establishedYear" label="In business since" hint="A year, like 2009.">
            <input
              id="establishedYear"
              name="establishedYear"
              inputMode="numeric"
              defaultValue={draft.establishedYear}
              placeholder="2009"
              className="border-border-default bg-canvas focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm tabular-nums outline-none focus-visible:ring-2"
            />
          </Field>
        </div>

        <Field
          id="contactEmail"
          label="Contact address"
          hint="Kept private. It is not in the directory and never appears on your public page — it is how we reach you about an enquiry."
        >
          <input
            id="contactEmail"
            name="contactEmail"
            type="email"
            defaultValue={draft.contactEmail}
            className="border-border-default bg-canvas focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
          />
        </Field>

        {error ? (
          <p className="text-danger text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="text-text-secondary text-sm" role="status">
            {message}
          </p>
        ) : null}

        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {hint ? <p className="text-text-muted text-xs leading-relaxed">{hint}</p> : null}
      {children}
    </div>
  );
}
