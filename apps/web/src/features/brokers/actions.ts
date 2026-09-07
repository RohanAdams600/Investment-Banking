'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { INDUSTRY_KEYS } from '@ib/core';

import { createClient } from '@/lib/supabase/server';

/**
 * Creating and publishing a firm's directory profile.
 *
 * ## Nothing here decides who may edit
 *
 * The policy on `firm_profiles` restricts every statement to
 * `app.is_firm_administrator(firm_id)`. This file passes a firm id and the
 * database decides — so an id substituted by an attacker matches no row rather
 * than editing somebody else's page. There is deliberately no membership check
 * in TypeScript to get out of sync with the policy.
 *
 * ## Publishing is its own action
 *
 * Saving and publishing are separate on purpose. A form where "Save" also makes
 * a page live is a form where somebody's firm appears in a public directory
 * because they were tidying a draft. The publish state is a switch they throw
 * knowingly, and it can be thrown back.
 */

export interface ProfileState {
  error: string | null;
  message: string | null;
}

const ok = (message: string): ProfileState => ({ error: null, message });
const fail = (error: string): ProfileState => ({ error, message: null });

/*
 * https, and only https.
 *
 * The database enforces this too. Both, because the schema constraint is the
 * guarantee and this is the readable error — a Postgres check violation reaching
 * a broker as a red box is a support ticket.
 */
const websiteSchema = z
  .string()
  .trim()
  .max(200)
  .refine((value) => value === '' || /^https:\/\/[^\s<>"]{3,}$/.test(value), {
    message: 'Your website must start with https:// — a plain http:// address is not accepted.',
  });

const profileSchema = z.object({
  headline: z.string().trim().max(120),
  about: z.string().trim().max(2000),
  website: websiteSchema,
  contactEmail: z.union([z.literal(''), z.string().trim().email()]),
  establishedYear: z.union([
    z.literal(''),
    z
      .string()
      .regex(/^\d{4}$/)
      .refine((y) => Number(y) >= 1900 && Number(y) <= new Date().getFullYear(), {
        message: 'Enter a year between 1900 and now.',
      }),
  ]),
});

/** `null` for an empty field, so the column holds NULL rather than an empty string. */
const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

export async function saveFirmProfile(
  _previous: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('Sign in to edit your profile.');

  const firmId = z.string().uuid().safeParse(formData.get('firmId')?.toString());
  if (!firmId.success) return fail('That firm could not be found.');

  const parsed = profileSchema.safeParse({
    headline: formData.get('headline')?.toString() ?? '',
    about: formData.get('about')?.toString() ?? '',
    website: formData.get('website')?.toString() ?? '',
    contactEmail: formData.get('contactEmail')?.toString() ?? '',
    establishedYear: formData.get('establishedYear')?.toString() ?? '',
  });

  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Some of those details could not be read.');
  }

  /*
   * Tags are checkboxes, so the submitted values are already from a fixed
   * vocabulary — but they arrive over the wire and a client can send anything.
   * Filtered against the real key list rather than trusted, and truncated to the
   * limits the schema enforces so a rejection is a sentence rather than a
   * constraint violation.
   */
  const industries = formData
    .getAll('industries')
    .map(String)
    .filter((key) => (INDUSTRY_KEYS as readonly string[]).includes(key))
    .slice(0, 8);

  const jurisdictions = formData
    .getAll('jurisdictions')
    .map(String)
    .filter((code) => /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(code))
    .slice(0, 12);

  const row = {
    firm_id: firmId.data,
    headline: orNull(parsed.data.headline),
    about: orNull(parsed.data.about),
    website: orNull(parsed.data.website),
    contact_email: orNull(parsed.data.contactEmail),
    established_year:
      parsed.data.establishedYear === '' ? null : Number(parsed.data.establishedYear),
    industries,
    jurisdictions,
  };

  /*
   * Upsert, because a firm has either no profile or exactly one and the form is
   * the same either way. `is_published` is deliberately absent from the payload:
   * an upsert that carried it would silently unpublish a live profile every time
   * somebody saved a wording change.
   */
  const { error } = await supabase.from('firm_profiles').upsert(row, { onConflict: 'firm_id' });

  if (error) {
    return fail(
      error.code === '23514'
        ? 'One of those fields is longer than allowed, or the website is not an https address.'
        : 'That could not be saved.',
    );
  }

  revalidatePath('/settings/directory');
  revalidatePath('/brokers');
  return ok('Saved.');
}

export async function setProfilePublished(
  _previous: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const supabase = await createClient();
  const firmId = z.string().uuid().safeParse(formData.get('firmId')?.toString());
  if (!firmId.success) return fail('That firm could not be found.');

  const publish = formData.get('publish') === 'true';

  const { error } = await supabase
    .from('firm_profiles')
    .update({ is_published: publish })
    .eq('firm_id', firmId.data);

  if (error) return fail('That could not be changed.');

  revalidatePath('/settings/directory');
  revalidatePath('/brokers');
  return ok(
    publish
      ? 'Your profile is live in the directory.'
      : 'Your profile is hidden. Nothing about your firm is public now.',
  );
}
