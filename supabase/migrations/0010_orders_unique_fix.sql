-- ============================================================================
-- IMS System — 0010: make order upserts actually work
--
-- The unique index on (org_id, channel_id, external_order_id) was partial
-- (WHERE external_order_id IS NOT NULL). Postgres cannot use a partial index as
-- an ON CONFLICT target, so every synced order failed to write. Replaced with a
-- proper unique constraint - nulls are still allowed, and Postgres treats them
-- as distinct, so manually created orders without an external id are unaffected.
-- ============================================================================

drop index if exists orders_org_id_channel_id_external_order_id_idx;

alter table orders drop constraint if exists orders_external_unique;

alter table orders
  add constraint orders_external_unique
  unique (org_id, channel_id, external_order_id);
