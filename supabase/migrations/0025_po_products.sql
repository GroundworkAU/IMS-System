-- ============================================================================
-- IMS System — 0025: our names and SKUs for an imported order
--
-- Suppliers use their own codes and descriptions. Before anything is created in
-- the point of sale we decide what it is actually called and what its SKU is.
-- One row per product on the order, with the sizes hanging off the order lines.
--
-- Variant products take the prefix plus the size (PAM27AFL001-M). Products
-- without variants just take the prefix.
-- ============================================================================

create table if not exists po_products (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organisations on delete cascade,
  po_id              uuid not null references purchase_orders on delete cascade,
  supplier_sku       text not null,
  supplier_name      text,
  colour             text,
  our_name           text,
  sku_prefix         text,
  has_variants       boolean not null default true,
  external_parent_id text,          -- the product family id once created
  pushed_at          timestamptz,
  push_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (po_id, supplier_sku)
);
create index if not exists po_products_po_idx on po_products (po_id);

create trigger po_products_set_updated_at
  before update on po_products
  for each row execute function set_updated_at();

alter table po_products enable row level security;

drop policy if exists "org members" on po_products;
create policy "org members" on po_products
  for all to authenticated
  using (org_id = current_org_id())
  with check (org_id = current_org_id());
