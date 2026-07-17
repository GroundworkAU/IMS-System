-- ============================================================================
-- IMS System — initial schema (v2, matches Inventory Internal System spec)
--
-- PAFC inbound purchasing + goods-inwards + allocation system, with supplier
-- and warehouse portals on top.
--
-- Flow: Order placed with brand (6-12mo ahead) -> confirmation uploaded (+file)
--   -> allocated to locations/staff -> Lightspeed CSV (field-mapped) -> warehouse
--   CSV -> inbound shipments/landings tracked -> Goods Inwards received & checked
--   -> discrepancies flagged. Plus Goods Outwards, returns, BigCommerce sync for
--   customer service / SOH comparison, and a full audit timeline per order/product.
--
-- Roles: admin, staff (PAFC internal, full access), supplier (scoped to own
--   brand), warehouse (operational). Granular supplier/warehouse RLS is layered
--   in a later migration when those portals are built — see section 13.
-- ============================================================================

create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ===========================================================================
-- 1. PEOPLE & ACCESS
-- ===========================================================================
create table suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,               -- our display name for the supplier
  contact_name  text,
  email         text,
  phone         text,
  address       text,
  payment_terms text,
  currency      text not null default 'AUD',
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table locations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,               -- e.g. "AWDS Warehouse", "Port Store Alberton"
  type          text not null default 'store'
                  check (type in ('warehouse','store','popup','other')),
  external_ref  text,                        -- Lightspeed outlet id
  address       text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  full_name     text,
  role          text not null default 'staff'
                  check (role in ('admin','staff','supplier','warehouse')),
  supplier_id   uuid references suppliers on delete set null,  -- for supplier users
  default_location_id uuid references locations on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ===========================================================================
-- 2. BRANDS  (input brand -> supplier auto-populates; supplier can own many brands)
-- ===========================================================================
create table brands (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,        -- e.g. Sherrin, Mitchell & Ness, New Era
  supplier_id   uuid not null references suppliers on delete restrict,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index on brands (supplier_id);

-- ===========================================================================
-- 3. CATALOG  (products + variants; supplier's own name/sku kept for indent reorders)
-- ===========================================================================
create table products (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid references brands on delete set null,
  name          text not null,               -- our display name
  category      text,
  description   text,
  status        text not null default 'active'
                  check (status in ('active','archived','draft')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on products (brand_id);

create table variants (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references products on delete cascade,
  sku                   text unique,          -- our / Lightspeed SKU
  supplier_sku          text,                 -- supplier's code (indent matching)
  supplier_product_name text,                 -- supplier's display name (indent matching)
  option_name           text,                 -- size, e.g. "M"
  barcode               text,                 -- nullable: often supplied later
  unit_cost             numeric(12,2) not null default 0,
  retail_price          numeric(12,2) not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on variants (product_id);
create index on variants (supplier_sku);
create index on variants (barcode);

-- ===========================================================================
-- 4. PURCHASE ORDERS from brands  (new products vs indent; assigned to brand + year)
-- ===========================================================================
create table purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  reference     text not null unique,         -- our PO reference
  brand_id      uuid not null references brands on delete restrict,
  supplier_id   uuid not null references suppliers on delete restrict,
  order_year    integer not null,             -- the season/year it belongs to
  order_type    text not null default 'indent'
                  check (order_type in ('new','indent')),
  status        text not null default 'draft'
                  check (status in ('draft','confirmed','in_transit',
                                    'partial','landed','closed','cancelled')),
  placed_date   date,
  barcode_status text not null default 'none'
                  check (barcode_status in ('none','partial','complete')),
  -- workflow milestones (who/when) — full detail also in activity_log
  lightspeed_uploaded_at  timestamptz,
  lightspeed_uploaded_by  uuid references profiles,
  warehouse_sent_at       timestamptz,
  warehouse_sent_by       uuid references profiles,
  notes         text,
  created_by    uuid references profiles,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on purchase_orders (brand_id);
create index on purchase_orders (order_year);
create index on purchase_orders (status);

create table purchase_order_lines (
  id                    uuid primary key default gen_random_uuid(),
  po_id                 uuid not null references purchase_orders on delete cascade,
  variant_id            uuid references variants on delete set null, -- null until new product created
  supplier_sku          text,
  supplier_product_name text,
  option_name           text,
  qty_ordered           integer not null check (qty_ordered > 0),
  unit_cost             numeric(12,2) not null default 0,
  barcode               text,                 -- provisional; nullable
  created_at            timestamptz not null default now()
);
create index on purchase_order_lines (po_id);

-- Allocation of units to a location AND/OR internal staff. location_id null =
-- "not yet assigned to a location".
create table po_allocations (
  id            uuid primary key default gen_random_uuid(),
  po_line_id    uuid not null references purchase_order_lines on delete cascade,
  location_id   uuid references locations on delete set null,
  assignee_id   uuid references profiles on delete set null,  -- assign to staff/internal
  qty           integer not null check (qty > 0),
  created_at    timestamptz not null default now()
);
create index on po_allocations (po_line_id);

-- ===========================================================================
-- 5. INBOUND SHIPMENTS / LANDINGS  (a PO can land in multiple shipments)
-- ===========================================================================
create table shipments (
  id                    uuid primary key default gen_random_uuid(),
  po_id                 uuid not null references purchase_orders on delete cascade,
  origin_type           text not null default 'supplier'
                          check (origin_type in ('supplier','location')),
  origin_location_id    uuid references locations on delete set null, -- when location->location
  destination_location_id uuid references locations on delete restrict,
  status                text not null default 'pending'
                          check (status in ('pending','not_sent','in_transit',
                                            'received','cancelled')),
  carrier               text,                 -- null for location->location
  tracking_number       text,
  tracking_url          text,
  estimated_delivery    date,
  sent_date             date,
  received_date         date,
  notes                 text,
  created_by            uuid references profiles,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on shipments (po_id);
create index on shipments (status);

create table shipment_lines (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   uuid not null references shipments on delete cascade,
  po_line_id    uuid references purchase_order_lines on delete set null,
  variant_id    uuid references variants on delete set null,
  qty           integer not null check (qty > 0)
);
create index on shipment_lines (shipment_id);

-- ===========================================================================
-- 6. GOODS INWARDS (receiving/check-off) & GOODS OUTWARDS
-- ===========================================================================
create table goods_inwards (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   uuid references shipments on delete set null,
  po_id         uuid references purchase_orders on delete set null,
  location_id   uuid not null references locations on delete restrict,
  status        text not null default 'submitted'
                  check (status in ('submitted','checking','accepted','discrepancy')),
  submitted_by  uuid references profiles,     -- PAFC submits
  submitted_at  timestamptz not null default now(),
  accepted_by   uuid references profiles,     -- warehouse checks off
  accepted_at   timestamptz,
  has_discrepancy boolean not null default false,
  notes         text
);
create index on goods_inwards (status);

create table goods_inwards_lines (
  id            uuid primary key default gen_random_uuid(),
  gi_id         uuid not null references goods_inwards on delete cascade,
  variant_id    uuid references variants on delete set null,
  qty_expected  integer not null default 0,
  qty_received  integer not null default 0,
  condition     text,
  note          text
);
create index on goods_inwards_lines (gi_id);

create table goods_outwards (
  id               uuid primary key default gen_random_uuid(),
  from_location_id uuid not null references locations on delete restrict,
  to_location_id   uuid references locations on delete set null,
  dispatch_method  text not null default 'ship'
                     check (dispatch_method in ('ship','pafc_collect')),
  status           text not null default 'draft'
                     check (status in ('draft','ready','sent','collected','cancelled')),
  created_by       uuid references profiles,
  dispatched_date  date,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create table goods_outwards_lines (
  id            uuid primary key default gen_random_uuid(),
  go_id         uuid not null references goods_outwards on delete cascade,
  variant_id    uuid references variants on delete set null,
  qty           integer not null check (qty > 0)
);
create index on goods_outwards_lines (go_id);

-- ===========================================================================
-- 7. INVENTORY  (SOH per location, plus append-only movement ledger)
-- ===========================================================================
create table inventory_levels (
  variant_id    uuid not null references variants on delete cascade,
  location_id   uuid not null references locations on delete cascade,
  on_hand       integer not null default 0,
  committed     integer not null default 0,
  incoming      integer not null default 0,
  reorder_point integer,
  updated_at    timestamptz not null default now(),
  primary key (variant_id, location_id)
);

create table inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid not null references variants on delete restrict,
  location_id   uuid not null references locations on delete restrict,
  delta         integer not null,
  reason        text not null
                  check (reason in ('goods_inwards','goods_outwards','transfer_in',
                                    'transfer_out','adjustment','sale','return','count')),
  reference_type text,
  reference_id  uuid,
  note          text,
  created_by    uuid references profiles,
  created_at    timestamptz not null default now()
);
create index on inventory_movements (variant_id, location_id);
create index on inventory_movements (reference_type, reference_id);

-- ===========================================================================
-- 8. SALES CHANNELS, ORDERS, CUSTOMERS  (BigCommerce/Lightspeed sync for CS + SOH)
-- ===========================================================================
create table sales_channels (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  platform      text not null
                  check (platform in ('bigcommerce','lightspeed','shopify','manual')),
  external_ref  text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table customers (
  id            uuid primary key default gen_random_uuid(),
  email         text,
  first_name    text,
  last_name     text,
  phone         text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index on customers (lower(email)) where email is not null;

create table orders (
  id                uuid primary key default gen_random_uuid(),
  channel_id        uuid references sales_channels on delete set null,
  external_order_id text,
  order_number      text,
  customer_id       uuid references customers on delete set null,
  status            text,
  financial_status  text,
  order_date        timestamptz,
  total             numeric(12,2) not null default 0,
  raw               jsonb,
  created_at        timestamptz not null default now()
);
create index on orders (customer_id);
create index on orders (order_number);
create unique index on orders (channel_id, external_order_id)
  where external_order_id is not null;

create table order_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders on delete cascade,
  variant_id    uuid references variants on delete set null,
  sku           text,
  name          text,
  qty           integer not null default 1,
  unit_price    numeric(12,2) not null default 0
);
create index on order_lines (order_id);

-- ===========================================================================
-- 9. RETURNS  (warehouse + PAFC: search order -> select -> return-to -> reason)
-- ===========================================================================
create table returns (
  id                    uuid primary key default gen_random_uuid(),
  rma_number            text not null unique,
  order_id              uuid references orders on delete set null,
  order_number          text,                 -- denormalised for search
  customer_id           uuid references customers on delete set null,
  returned_to_location_id uuid references locations on delete set null,
  return_date           date not null default current_date,
  reason                text,
  status                text not null default 'requested'
                          check (status in ('requested','approved','received',
                                            'refunded','rejected')),
  logged_by             uuid references profiles,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create table return_lines (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references returns on delete cascade,
  order_line_id uuid references order_lines on delete set null,
  variant_id    uuid references variants on delete set null,
  qty           integer not null check (qty > 0),
  condition     text check (condition in ('resalable','damaged','faulty'))
);
create index on return_lines (return_id);

-- ===========================================================================
-- 10. FIELD MAPPING & EXPORT TEMPLATES
--     Supplier confirmation files vary; column config is kept as JSONB so we can
--     finalise exact columns once the real Lightspeed / warehouse / supplier
--     templates are provided, without a schema change.
-- ===========================================================================
create table import_templates (         -- describes a supplier's order-file format
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references suppliers on delete cascade,
  name          text not null,
  source_format text not null default 'excel'
                  check (source_format in ('excel','csv','pdf')),
  column_config jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on import_templates (supplier_id);

create table export_mappings (          -- supplier fields -> Lightspeed / warehouse
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid references suppliers on delete cascade,
  target        text not null check (target in ('lightspeed','warehouse')),
  mapping       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on export_mappings (supplier_id, target);

-- ===========================================================================
-- 11. INTEGRATIONS (BigCommerce / Lightspeed API creds)
--     SECURITY: raw API keys are NOT stored here. The secret lives in Supabase
--     Vault; this table only references it. See note in the response.
-- ===========================================================================
create table integration_settings (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null unique
                    check (provider in ('bigcommerce','lightspeed')),
  config          jsonb not null default '{}'::jsonb,  -- non-secret config (store hash, urls)
  vault_secret_id uuid,                                 -- reference to vault.secrets
  is_active       boolean not null default false,
  updated_by      uuid references profiles,
  updated_at      timestamptz not null default now()
);

-- ===========================================================================
-- 12. ATTACHMENTS & ACTIVITY LOG (audit timeline per order/product/etc.)
-- ===========================================================================
create table attachments (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null,          -- 'purchase_order','supplier_invoice',...
  entity_id     uuid not null,
  file_url      text not null,          -- Supabase storage path
  file_name     text,
  uploaded_by   uuid references profiles,
  created_at    timestamptz not null default now()
);
create index on attachments (entity_type, entity_id);

create table activity_log (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references profiles on delete set null,
  action        text not null,          -- 'sent_to_warehouse','confirmed_upload',...
  entity_type   text not null,          -- 'purchase_order','product','goods_inwards',...
  entity_id     uuid not null,
  detail        jsonb,
  created_at    timestamptz not null default now()
);
create index on activity_log (entity_type, entity_id, created_at);

-- ===========================================================================
-- 13. updated_at triggers + RLS
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'suppliers','locations','profiles','products','variants','purchase_orders',
    'shipments','goods_outwards','customers','returns',
    'import_templates','export_mappings'
  ] loop
    execute format('create trigger %I_set_updated_at before update on %I
      for each row execute function set_updated_at();', t, t);
  end loop;
end $$;

-- role helpers
create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active and role in ('admin','staff')
  );
$$;

-- Baseline policy set: PAFC staff/admin get full access to everything now.
-- Scoped supplier + warehouse policies are added in migration 0002 alongside
-- their portals (supplier sees own brand only; warehouse gets GI/GO/returns).
do $$
declare t text;
begin
  foreach t in array array[
    'suppliers','locations','profiles','brands','products','variants',
    'purchase_orders','purchase_order_lines','po_allocations','shipments',
    'shipment_lines','goods_inwards','goods_inwards_lines','goods_outwards',
    'goods_outwards_lines','inventory_levels','inventory_movements',
    'sales_channels','customers','orders','order_lines','returns','return_lines',
    'import_templates','export_mappings','integration_settings','attachments',
    'activity_log'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('create policy "staff full access" on %I
      for all to authenticated using (is_staff()) with check (is_staff());', t);
  end loop;
end $$;

-- Everyone authenticated can read their own profile (so the app can resolve role).
create policy "read own profile" on profiles
  for select to authenticated using (id = auth.uid());
