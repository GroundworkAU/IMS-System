-- ============================================================================
-- IMS System — 0018: import suppliers and brands from a connected platform
--
-- Platforms keep brands and suppliers as separate lists with no link between
-- them, so an imported brand may not have a supplier yet. Making supplier_id
-- optional lets them come in and be matched up afterwards.
-- ============================================================================

alter table brands alter column supplier_id drop not null;

alter table suppliers
  add column if not exists external_id text,
  add column if not exists external_source text,
  add column if not exists last_synced_at timestamptz;

alter table brands
  add column if not exists external_id text,
  add column if not exists external_source text,
  add column if not exists last_synced_at timestamptz;

alter table suppliers drop constraint if exists suppliers_external_unique;
alter table suppliers
  add constraint suppliers_external_unique
  unique (org_id, external_source, external_id);

alter table brands drop constraint if exists brands_external_unique;
alter table brands
  add constraint brands_external_unique
  unique (org_id, external_source, external_id);
