-- ============================================================================
-- IMS System — 0026: who can delete a purchase order
--
-- Deleting takes its lines and product rows with it, so it is limited to owners
-- and admins, or whoever imported it. Anything already created in the point of
-- sale stays there ~ this only removes our record of the order.
-- ============================================================================

drop policy if exists "org members" on purchase_orders;

create policy "read purchase orders" on purchase_orders
  for select to authenticated using (org_id = current_org_id());

create policy "create purchase orders" on purchase_orders
  for insert to authenticated with check (org_id = current_org_id());

create policy "update purchase orders" on purchase_orders
  for update to authenticated
  using (org_id = current_org_id())
  with check (org_id = current_org_id());

create policy "delete purchase orders" on purchase_orders
  for delete to authenticated
  using (
    org_id = current_org_id()
    and (has_org_role(array['owner','admin']) or created_by = auth.uid())
  );
