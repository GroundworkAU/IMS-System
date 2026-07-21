-- ============================================================================
-- IMS System — 0019: exclude products from syncing
--
-- A separate flag rather than reusing `status`, because status is overwritten
-- from the platform on every sync (it mirrors whether the product is visible
-- there). This one is yours and the sync never touches it.
-- ============================================================================

alter table products
  add column if not exists sync_enabled boolean not null default true;

create index if not exists products_sync_enabled_idx
  on products (org_id, external_source, sync_enabled);
