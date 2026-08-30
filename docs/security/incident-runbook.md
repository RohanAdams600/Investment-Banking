# Incident runbook

What to do when something has gone wrong. Written now because nobody writes one
during an incident, and the first hour is when the decisions that matter get
made badly.

**Assume you are tired, it is late, and you are not thinking clearly.** That is
when these happen. Follow the order.

---

## 0. Before anything: is it actually an incident?

An incident is any of:

- A credential is exposed — a service-role key in a screenshot, a token pasted
  into a chat, a laptop lost.
- Someone reports they can see data belonging to another user.
- The audit log shows a pattern nobody can explain — bulk document access, NDA
  requests across many listings, sign-ins from somewhere impossible.
- A researcher emails about a vulnerability.

A slow page is not an incident. A confused user is usually not an incident.
**If you are unsure, treat it as one for the first thirty minutes** — the cost
of over-reacting is an evening; the cost of under-reacting is every seller's
financials.

## 1. Stop the bleeding (first 15 minutes)

Do these in order, and do not stop to investigate first.

1. **Rotate the service-role key.** Supabase → Settings → API → roll it. This
   is the credential that bypasses every policy in the database. Redeploy with
   the new value.
2. **Revoke every session.** Supabase → Authentication → Users, or:
   ```sql
   delete from auth.sessions;
   ```
   Everyone is signed out, including the attacker. Yes, including you.
3. **Revoke every agent token:**
   ```sql
   update public.mcp_tokens set revoked_at = now() where revoked_at is null;
   ```
4. **If a specific account is compromised**, disable it rather than deleting it
   — you will need its history:
   ```sql
   update auth.users set banned_until = now() + interval '100 years' where id = '<uuid>';
   ```

## 2. Work out what was reached (next hour)

The audit log and the document access log are the record. They are append-only
and are not purged.

```sql
-- Everything one account did
select action, entity_type, entity_id, created_at
  from public.audit_log where actor_user_id = '<uuid>' order by created_at desc;

-- Which confidential documents were opened, by whom
select l.document_id, l.actor_id, l.action, l.ip_address, l.created_at
  from public.document_access_log l
 where l.created_at > now() - interval '30 days'
 order by l.created_at desc;

-- Which confidentiality agreements were issued, and by whom
select listing_id, buyer_id, status, sent_at, signed_at, revoked_at
  from public.listing_ndas where sent_at > now() - interval '30 days';
```

Write down what you find as you go. You will be asked to repeat it later and
memory is not evidence.

## 3. Tell people

**Sellers first.** Their confidential financials are the thing at risk, and they
gave them to you on a promise. Tell them what was reached, when, and what you
have done — even when the answer is "we do not yet know the full extent". A
seller who hears it from you keeps working with you; one who finds out
otherwise does not.

Notification timing is a legal question with real deadlines that vary by state
and by what was exposed. **Call counsel the same day.** Do not send a
notification you have not had reviewed, and do not delay the technical response
waiting for that review.

## 4. Afterwards

- Write what happened, in plain language, while it is fresh.
- Fix the cause, not the symptom, and add a test that fails without the fix.
- If it came from a researcher, thank them and credit them if they want it.

---

## Standing contacts

Fill these in before you need them. An empty table here is the failure this
document exists to prevent.

| Role | Who | How |
| --- | --- | --- |
| Counsel (privacy / breach notification) | — | — |
| Counsel (transactions / brokerage) | — | — |
| Insurance (E&O / cyber) | — | — |
| Supabase support | — | Dashboard → Support |
| Hosting support | — | — |

## What is already in place

So you know what you have when it happens:

- Every table has RLS, enabled and forced, checked on every schema run.
- Confidential listing data is deleted 90 days after a deal ends, so the window
  of exposure is bounded.
- Documents are view-only by default, watermarked with the viewer's identity,
  and every access is logged.
- Anything reaching a third party's confidential data requires a second factor,
  including the operator panel.
- Agent tokens are stored as SHA-256 digests, expire, and can be revoked in one
  statement.

## What is not, and would help

- **No alerting.** Nothing tells you about a failed-auth spike or bulk document
  access; you would find it by looking. This is the largest remaining gap.
- **No tested restore.** Point-in-time recovery may be enabled; a backup nobody
  has restored is a hypothesis.
- **No penetration test.** Approved, not yet commissioned.
