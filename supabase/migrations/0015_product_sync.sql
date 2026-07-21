-- ============================================================================
-- IMS System — 0015: let products and variants come from a connected platform
--
-- Products are keyed on (org, source, external id) so a sync can upsert cleanly
-- and the same product can later be matched across platforms by SKU.
-- ============================================================================

alter table products
  add column if not exists external_id text,
  add column if not exists external_source text,
  add column if not exists external_brand text,
  add column if not exists image_url text,
  add column if not exists last_synced_at timestamptz;

alter table variants
  add column if not exists external_id text,
  add column if not exists external_source text,
  add column if not exists last_synced_at timestamptz;

-- Proper unique constraints (not partial indexes) so upserts can target them.
alter table products drop constraint if exists products_external_unique;
alter table products
  add constraint products_external_unique
  unique (org_id, external_source, external_id);

alter table variants drop constraint if exists variants_external_unique;
alter table variants
  add constraint variants_external_unique
  unique (org_id, external_source, external_id);

-- SKUs are not reliably unique in every platform's catalogue (blank or repeated
-- SKUs are common), and a failed sync is worse than a duplicate SKU. Keep it
-- indexed for lookups, but no longer enforced.
alter table variants drop constraint if exists variants_org_id_sku_key;
create index if not exists variants_org_sku_idx on variants (org_id, sku);
