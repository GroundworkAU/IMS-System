-- ============================================================================
-- IMS System — 0013: who can edit and delete returns / order issues
--
-- Everyone in the business can read and update them (the warehouse needs to
-- correct their own mistakes). Deleting is destructive, so it is limited to
-- owners and admins, or the person who raised the record.
-- ============================================================================

-- ---- returns --------------------------------------------------------------
drop policy if exists "org members" on returns;

create policy "read returns" on returns
  for select to authenticated using (org_id = current_org_id());

create policy "create returns" on returns
  for insert to authenticated with check (org_id = current_org_id());

create policy "update returns" on returns
  for update to authenticated
  using (org_id = current_org_id())
  with check (org_id = current_org_id());

create policy "delete returns" on returns
  for delete to authenticated
  using (
    org_id = current_org_id()
    and (has_org_role(array['owner','admin']) or logged_by = auth.uid())
  );

-- ---- order issues ---------------------------------------------------------
drop policy if exists "org members" on order_issues;

create policy "read issues" on order_issues
  for select to authenticated using (org_id = current_org_id());

create policy "create issues" on order_issues
  for insert to authenticated with check (org_id = current_org_id());

create policy "update issues" on order_issues
  for update to authenticated
  using (org_id = current_org_id())
  with check (org_id = current_org_id());

create policy "delete issues" on order_issues
  for delete to authenticated
  using (
    org_id = current_org_id()
    and (has_org_role(array['owner','admin']) or raised_by = auth.uid())
  );
