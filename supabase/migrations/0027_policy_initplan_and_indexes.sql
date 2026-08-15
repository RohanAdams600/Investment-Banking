-- Making the policies scale, and indexing what a delete has to scan.
--
-- No behaviour changes here. Every policy below is the same predicate it was
-- before, and the 800-test suite is what proves that — this migration would be
-- unreviewable otherwise, and "trust me, the boolean logic is identical" is not
-- a review.
--
-- ---------------------------------------------------------------------------
-- Why `(select auth.uid())` and not `auth.uid()`
-- ---------------------------------------------------------------------------
--
-- `auth.uid()` reads a GUC. Written bare in a policy it is a per-row expression,
-- so Postgres calls it **once for every row it examines** — a thousand-listing
-- browse calls it a thousand times, and it gets worse exactly as the platform
-- gets busier.
--
-- Wrapped in a scalar subquery it becomes an InitPlan: evaluated once, before
-- the scan, and compared as a constant. Same answer, one call.
--
-- This is not a micro-optimisation. It is the difference between a page that
-- loads and a page that times out, and it is invisible on a database with
-- fifty rows in it — which is to say, invisible right up until launch.
--
-- Note what is *not* wrapped: calls to `app.controls_listing(listing_id)` and
-- friends. Those take the row as an argument, so they are correlated by
-- definition and cannot be hoisted. Their cost is real and inherent; this
-- migration does not pretend otherwise.
--
-- ---------------------------------------------------------------------------
-- The indexes
-- ---------------------------------------------------------------------------
--
-- The linter reports 39 foreign keys with no covering index. Adding 39 indexes
-- would be cargo cult: every index costs write throughput on every insert, and
-- most of those columns are `created_by` / `actor_id` audit trails that nothing
-- ever filters on.
--
-- What actually needs one is narrower and has a rule behind it: a foreign key
-- whose *parent* gets deleted, because `on delete cascade` and `on delete
-- restrict` both make the parent's delete scan the child table. Plus the two
-- columns a real query path filters on today. The audit columns are left bare,
-- deliberately.

-- ===========================================================================
-- Policies
-- ===========================================================================

drop policy if exists acquisition_criteria_own on public.acquisition_criteria;
create policy acquisition_criteria_own on public.acquisition_criteria
  for all to authenticated
  using ((user_id = ( SELECT auth.uid() )))
  with check ((user_id = ( SELECT auth.uid() )));

drop policy if exists agent_runs_select_subject on public.agent_runs;
create policy agent_runs_select_subject on public.agent_runs
  for select to authenticated
  using (((subject_user_id = ( SELECT auth.uid() )) OR ((listing_id IS NOT NULL) AND app.controls_listing(listing_id)) OR ((firm_id IS NOT NULL) AND app.is_firm_member(firm_id))));

drop policy if exists audit_log_select_self on public.audit_log;
create policy audit_log_select_self on public.audit_log
  for select to authenticated
  using (((actor_user_id = ( SELECT auth.uid() )) OR app.is_platform_admin()));

drop policy if exists buyer_profiles_own on public.buyer_profiles;
create policy buyer_profiles_own on public.buyer_profiles
  for all to authenticated
  using ((user_id = ( SELECT auth.uid() )))
  with check ((user_id = ( SELECT auth.uid() )));

drop policy if exists consent_records_insert_self on public.consent_records;
create policy consent_records_insert_self on public.consent_records
  for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() )));

drop policy if exists consent_records_select_self on public.consent_records;
create policy consent_records_select_self on public.consent_records
  for select to authenticated
  using (((user_id = ( SELECT auth.uid() )) OR app.is_platform_admin()));

drop policy if exists conversation_members_select_members on public.conversation_members;
create policy conversation_members_select_members on public.conversation_members
  for select to authenticated
  using ((app.is_active_conversation_member(conversation_id) OR (user_id = ( SELECT auth.uid() )) OR app.is_platform_admin()));

drop policy if exists deal_documents_insert on public.deal_documents;
create policy deal_documents_insert on public.deal_documents
  for insert to authenticated
  with check ((app.can_access_deal(deal_id) AND (uploaded_by = ( SELECT auth.uid() )) AND ((firm_id IS NULL) OR app.is_firm_member(firm_id))));

drop policy if exists document_access_log_select on public.document_access_log;
create policy document_access_log_select on public.document_access_log
  for select to authenticated
  using (((actor_id = ( SELECT auth.uid() )) OR app.controls_document(document_id)));

drop policy if exists document_grants_select on public.document_grants;
create policy document_grants_select on public.document_grants
  for select to authenticated
  using (((grantee_id = ( SELECT auth.uid() )) OR app.controls_document(document_id)));

drop policy if exists fee_agreements_write_admin on public.fee_agreements;
create policy fee_agreements_write_admin on public.fee_agreements
  for insert to authenticated
  with check ((app.can_administer_firm(firm_id) AND (created_by = ( SELECT auth.uid() ))));

drop policy if exists legal_document_drafts_insert on public.legal_document_drafts;
create policy legal_document_drafts_insert on public.legal_document_drafts
  for insert to authenticated
  with check ((created_by = ( SELECT auth.uid() )));

drop policy if exists legal_document_drafts_read on public.legal_document_drafts;
create policy legal_document_drafts_read on public.legal_document_drafts
  for select to authenticated
  using (((created_by = ( SELECT auth.uid() )) OR ((deal_id IS NOT NULL) AND app.can_access_deal(deal_id))));

drop policy if exists legal_document_drafts_update_own on public.legal_document_drafts;
create policy legal_document_drafts_update_own on public.legal_document_drafts
  for update to authenticated
  using ((created_by = ( SELECT auth.uid() )))
  with check ((created_by = ( SELECT auth.uid() )));

drop policy if exists legal_document_versions_insert on public.legal_document_versions;
create policy legal_document_versions_insert on public.legal_document_versions
  for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM legal_document_drafts d
  WHERE ((d.id = legal_document_versions.draft_id) AND (d.created_by = ( SELECT auth.uid() ))))));

drop policy if exists listing_ndas_insert_buyer on public.listing_ndas;
create policy listing_ndas_insert_buyer on public.listing_ndas
  for insert to authenticated
  with check (((buyer_id = ( SELECT auth.uid() )) AND (status = 'requested'::app.nda_status) AND app.listing_is_discoverable(listing_id) AND app.is_buy_side()));

drop policy if exists listing_ndas_select_party on public.listing_ndas;
create policy listing_ndas_select_party on public.listing_ndas
  for select to authenticated
  using (((buyer_id = ( SELECT auth.uid() )) OR app.controls_listing(listing_id)));

drop policy if exists listing_ndas_update_party on public.listing_ndas;
create policy listing_ndas_update_party on public.listing_ndas
  for update to authenticated
  using (((buyer_id = ( SELECT auth.uid() )) OR app.controls_listing(listing_id)))
  with check (((buyer_id = ( SELECT auth.uid() )) OR app.controls_listing(listing_id)));

drop policy if exists listing_saves_own on public.listing_saves;
create policy listing_saves_own on public.listing_saves
  for all to authenticated
  using ((user_id = ( SELECT auth.uid() )))
  with check (((user_id = ( SELECT auth.uid() )) AND app.listing_is_discoverable(listing_id)));

drop policy if exists listings_insert_own on public.listings;
create policy listings_insert_own on public.listings
  for insert to authenticated
  with check (((seller_id = ( SELECT auth.uid() )) AND app.can_create_listing() AND (status = 'draft'::app.listing_status) AND ((firm_id IS NULL) OR app.is_firm_member(firm_id))));

drop policy if exists match_scores_select_own on public.match_scores;
create policy match_scores_select_own on public.match_scores
  for select to authenticated
  using ((buyer_id = ( SELECT auth.uid() )));

drop policy if exists messages_insert_members on public.messages;
create policy messages_insert_members on public.messages
  for insert to authenticated
  with check (((sender_id = ( SELECT auth.uid() )) AND app.is_active_conversation_member(conversation_id)));

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update to authenticated
  using (((sender_id = ( SELECT auth.uid() )) AND (deleted_at IS NULL) AND app.is_active_conversation_member(conversation_id)))
  with check (((sender_id = ( SELECT auth.uid() )) AND (deleted_at IS NULL) AND app.is_active_conversation_member(conversation_id)));

drop policy if exists notification_preferences_own on public.notification_preferences;
create policy notification_preferences_own on public.notification_preferences
  for all to authenticated
  using ((user_id = ( SELECT auth.uid() )))
  with check ((user_id = ( SELECT auth.uid() )));

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using ((recipient_id = ( SELECT auth.uid() )));

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using ((recipient_id = ( SELECT auth.uid() )))
  with check ((recipient_id = ( SELECT auth.uid() )));

drop policy if exists outreach_drafts_select_party on public.outreach_drafts;
create policy outreach_drafts_select_party on public.outreach_drafts
  for select to authenticated
  using ((app.controls_listing(listing_id) OR ((recipient_id = ( SELECT auth.uid() )) AND (status = 'sent'::app.outreach_status))));

drop policy if exists outreach_drafts_write_controller on public.outreach_drafts;
create policy outreach_drafts_write_controller on public.outreach_drafts
  for insert to authenticated
  with check ((app.controls_listing(listing_id) AND (created_by = ( SELECT auth.uid() ))));

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check ((id = ( SELECT auth.uid() )));

drop policy if exists profiles_select_self_or_colleagues on public.profiles;
create policy profiles_select_self_or_colleagues on public.profiles
  for select to authenticated
  using (((id = ( SELECT auth.uid() )) OR app.is_platform_admin() OR (EXISTS ( SELECT 1
   FROM firm_members fm
  WHERE ((fm.user_id = profiles.id) AND (fm.firm_id IN ( SELECT app.user_firm_ids() AS user_firm_ids)))))));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using ((id = ( SELECT auth.uid() )))
  with check ((id = ( SELECT auth.uid() )));

drop policy if exists questionnaire_responses_own on public.questionnaire_responses;
create policy questionnaire_responses_own on public.questionnaire_responses
  for all to authenticated
  using ((user_id = ( SELECT auth.uid() )))
  with check ((user_id = ( SELECT auth.uid() )));

drop policy if exists seller_preferences_own on public.seller_preferences;
create policy seller_preferences_own on public.seller_preferences
  for all to authenticated
  using ((user_id = ( SELECT auth.uid() )))
  with check ((user_id = ( SELECT auth.uid() )));

drop policy if exists seller_preferences_select_counterparty on public.seller_preferences;
create policy seller_preferences_select_counterparty on public.seller_preferences
  for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM (listings l
     JOIN listing_ndas n ON ((n.listing_id = l.id)))
  WHERE ((l.seller_id = seller_preferences.user_id) AND (n.buyer_id = ( SELECT auth.uid() )) AND (n.status = 'signed'::app.nda_status) AND (n.revoked_at IS NULL) AND ((n.expires_at IS NULL) OR (n.expires_at > now()))))));

drop policy if exists user_roles_delete_self_non_admin on public.user_roles;
create policy user_roles_delete_self_non_admin on public.user_roles
  for delete to authenticated
  using (((user_id = ( SELECT auth.uid() )) AND (role <> 'admin'::app.platform_role)));

drop policy if exists user_roles_insert_self_non_admin on public.user_roles;
create policy user_roles_insert_self_non_admin on public.user_roles
  for insert to authenticated
  with check (((user_id = ( SELECT auth.uid() )) AND (role <> 'admin'::app.platform_role)));

drop policy if exists user_roles_select_self on public.user_roles;
create policy user_roles_select_self on public.user_roles
  for select to authenticated
  using (((user_id = ( SELECT auth.uid() )) OR app.is_platform_admin()));

drop policy if exists valuation_estimates_own on public.valuation_estimates;
create policy valuation_estimates_own on public.valuation_estimates
  for all to authenticated
  using ((user_id = ( SELECT auth.uid() )))
  with check ((user_id = ( SELECT auth.uid() )));

-- ===========================================================================
-- Indexes a delete has to scan
-- ===========================================================================

-- `on delete cascade`. Deleting a deal or a firm walks every agent run looking
-- for children; without these that is a sequential scan of the whole table.
create index if not exists agent_runs_deal_idx on public.agent_runs (deal_id);
create index if not exists agent_runs_firm_idx on public.agent_runs (firm_id);

-- Same, one level down the CRM. Deleting a contact cascades to its tasks.
create index if not exists crm_tasks_contact_idx on public.crm_tasks (contact_id);
create index if not exists crm_tasks_lead_idx on public.crm_tasks (lead_id);

/*
 * The one that is not about deletes at all.
 *
 * `recomputeMatchesForBuyer` opens with `delete from match_scores where
 * buyer_id = $1`, and the existing buyer index is partial — `where not
 * excluded` — so it cannot serve a delete that has to remove the excluded rows
 * too. That statement is a sequential scan today, on the table that grows as
 * listings × buyers, behind a button a buyer can press themselves.
 */
create index if not exists match_scores_buyer_all_idx on public.match_scores (buyer_id);

-- `on delete restrict`: the parent's delete still has to look, and a restrict
-- that scans is a delete that hangs rather than one that refuses quickly.
create index if not exists commission_records_agreement_idx
  on public.commission_records (agreement_id);
create index if not exists legal_document_drafts_template_idx
  on public.legal_document_drafts (template_id);
create index if not exists listing_ndas_template_idx on public.listing_ndas (template_id);
create index if not exists fee_agreements_created_by_idx on public.fee_agreements (created_by);
create index if not exists outreach_drafts_created_by_idx on public.outreach_drafts (created_by);

-- Restrict *and* a filter buyers actually use: browse is scoped by location.
create index if not exists listings_jurisdiction_idx on public.listings (jurisdiction_code);

/*
 * The two I first argued out of the list, and put back.
 *
 * The reasoning for skipping them was that a jurisdiction is never deleted —
 * it is toggled inactive. That is true today and it is exactly the kind of
 * assumption that stops being true without anybody noticing. A rule with an
 * unstated exception is worse than a uniform one, and the schema test that
 * enforces this rule does not know about my exception either.
 */
create index if not exists consent_records_jurisdiction_idx
  on public.consent_records (jurisdiction_code);
create index if not exists legal_templates_jurisdiction_idx
  on public.legal_templates (jurisdiction_code);

-- Query paths rather than deletes. The pipeline board groups leads by stage,
-- and a lead carries the listing it came from.
create index if not exists leads_stage_idx on public.leads (stage_id);
create index if not exists leads_listing_idx on public.leads (listing_id);
