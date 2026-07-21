-- ============================================================================
-- IMS System — 0003: multi-tenant rewrite
--
-- Converts the single-org schema into a multi-business product:
--   * organisations own every row (org_id on all business tables)
--   * RLS scopes every query to the caller's organisation
--   * uniqueness rules are per-organisation, not global
--   * self-serve signup: create an org (become owner) or accept an invite
--   * billing fields present but unwired (Stripe added later)
--
-- Safe full reset: no production data yet.
-- ============================================================================

-- ===== RESET ================================================================
drop trigger if exists on_auth_user_created on auth.users;
drop table if exists
  activity_log, attachments, integration_settings, export_mappings,
  import_templates, return_lines, returns, order_lines, orders, customers,
  sales_channels, inventory_movements, inventory_levels, goods_outwards_lines,
  goods_outwards, goods_inwards_lines, goods_inwards, shipment_lines, shipments,
  po_allocations, purchase_order_lines, purchase_orders, variants, products,
  brands, org_invitations, profiles, locations, suppliers, organisations
cascade;
drop function if exists handle_new_user() cascade;
drop function if exists set_updated_at() cascade;
drop function if exists is_staff() cascade;
drop function if exists current_org_id() cascade;
drop function if exists has_org_role(text[]) cascade;
drop function if exists create_organisation(text) cascade;
drop function if exists accept_invitation(uuid) cascade;

-- ===== FOUNDATION ===========================================================
create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table organisations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique,
  -- billing (structured now, wired to Stripe later)
  plan                 text not null default 'trial'
                         check (plan in ('trial','starter','growth','enterprise')),
  subscription_status  text not null default 'trialing'
                         check (subscription_status in
                           ('trialing','active','past_due','cancelled')),
  trial_ends_at        timestamptz default (now() + interval '30 days'),
  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- profiles.org_id is null until the user creates or joins an organisation.
create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  org_id        uuid references organisations on delete cascade,
  full_name     text,
  email         text,
  role          text not null default 'staff'
                  check (role in ('owner','admin','staff','warehouse','supplier')),
  supplier_id   uuid,                    -- FK added after suppliers exists
  default_location_id uuid,              -- FK added after locations exists
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on profiles (org_id);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Tenancy helpers.
-- SECURITY DEFINER so they bypass RLS when reading profiles — without this the
-- profiles policy would call a function that reads profiles, causing infinite
-- recursion.
-- ---------------------------------------------------------------------------
create or replace function current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid() and is_active;
$$;

create or replace function has_org_role(allowed text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active and role = any(allowed)
  );
$$;

-- ===== CORE TABLES ==========================================================
create table suppliers (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  name          text not null,
  contact_name  text, email text, phone text, address text,
  payment_terms text,
  currency      text not null default 'AUD',
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, name)
);
create index on suppliers (org_id);

create table locations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  name          text not null,
  type          text not null default 'store'
                  check (type in ('warehouse','store','popup','other')),
  external_ref  text, address text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, name)
);
create index on locations (org_id);

alter table profiles
  add constraint profiles_supplier_fk
    foreign key (supplier_id) references suppliers on delete set null,
  add constraint profiles_location_fk
    foreign key (default_location_id) references locations on delete set null;

create table org_invitations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  email         text not null,
  role          text not null default 'staff'
                  check (role in ('admin','staff','warehouse','supplier')),
  supplier_id   uuid references suppliers on delete set null,
  token         uuid not null default gen_random_uuid(),
  status        text not null default 'pending'
                  check (status in ('pending','accepted','revoked')),
  invited_by    uuid references profiles on delete set null,
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  unique (org_id, email, status)
);
create index on org_invitations (token);

create table brands (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  name          text not null,
  supplier_id   uuid not null references suppliers on delete restrict,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (org_id, name)
);
create index on brands (org_id);

create table products (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  brand_id      uuid references brands on delete set null,
  name          text not null, category text, description text,
  status        text not null default 'active'
                  check (status in ('active','archived','draft')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on products (org_id);
create index on products (brand_id);

create table variants (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations on delete cascade,
  product_id            uuid not null references products on delete cascade,
  sku                   text,
  supplier_sku          text, supplier_product_name text, option_name text,
  barcode               text,
  unit_cost             numeric(12,2) not null default 0,
  retail_price          numeric(12,2) not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, sku)
);
create index on variants (org_id);
create index on variants (product_id);
create index on variants (supplier_sku);
create index on variants (barcode);

create table purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  reference     text not null,
  brand_id      uuid not null references brands on delete restrict,
  supplier_id   uuid not null references suppliers on delete restrict,
  order_year    integer not null,
  order_type    text not null default 'indent'
                  check (order_type in ('new','indent')),
  status        text not null default 'draft'
                  check (status in ('draft','confirmed','in_transit',
                                    'partial','landed','closed','cancelled')),
  placed_date   date,
  barcode_status text not null default 'none'
                  check (barcode_status in ('none','partial','complete')),
  lightspeed_uploaded_at timestamptz,
  lightspeed_uploaded_by uuid references profiles,
  warehouse_sent_at      timestamptz,
  warehouse_sent_by      uuid references profiles,
  notes         text,
  created_by    uuid references profiles,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, reference)
);
create index on purchase_orders (org_id);
create index on purchase_orders (brand_id);
create index on purchase_orders (order_year);
create index on purchase_orders (status);

create table purchase_order_lines (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations on delete cascade,
  po_id                 uuid not null references purchase_orders on delete cascade,
  variant_id            uuid references variants on delete set null,
  supplier_sku          text, supplier_product_name text, option_name text,
  qty_ordered           integer not null check (qty_ordered > 0),
  unit_cost             numeric(12,2) not null default 0,
  barcode               text,
  created_at            timestamptz not null default now()
);
create index on purchase_order_lines (org_id);
create index on purchase_order_lines (po_id);

create table po_allocations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  po_line_id    uuid not null references purchase_order_lines on delete cascade,
  location_id   uuid references locations on delete set null,
  assignee_id   uuid references profiles on delete set null,
  qty           integer not null check (qty > 0),
  created_at    timestamptz not null default now()
);
create index on po_allocations (org_id);
create index on po_allocations (po_line_id);

create table shipments (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations on delete cascade,
  po_id                 uuid not null references purchase_orders on delete cascade,
  origin_type           text not null default 'supplier'
                          check (origin_type in ('supplier','location')),
  origin_location_id    uuid references locations on delete set null,
  destination_location_id uuid references locations on delete restrict,
  status                text not null default 'pending'
                          check (status in ('pending','not_sent','in_transit',
                                            'received','cancelled')),
  carrier text, tracking_number text, tracking_url text,
  estimated_delivery date, sent_date date, received_date date, notes text,
  created_by            uuid references profiles,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on shipments (org_id);
create index on shipments (po_id);
create index on shipments (status);

create table shipment_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  shipment_id   uuid not null references shipments on delete cascade,
  po_line_id    uuid references purchase_order_lines on delete set null,
  variant_id    uuid references variants on delete set null,
  qty           integer not null check (qty > 0)
);
create index on shipment_lines (org_id);
create index on shipment_lines (shipment_id);

create table goods_inwards (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  shipment_id   uuid references shipments on delete set null,
  po_id         uuid references purchase_orders on delete set null,
  location_id   uuid not null references locations on delete restrict,
  status        text not null default 'submitted'
                  check (status in ('submitted','checking','accepted','discrepancy')),
  submitted_by  uuid references profiles,
  submitted_at  timestamptz not null default now(),
  accepted_by   uuid references profiles,
  accepted_at   timestamptz,
  has_discrepancy boolean not null default false,
  notes         text
);
create index on goods_inwards (org_id);
create index on goods_inwards (status);

create table goods_inwards_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  gi_id         uuid not null references goods_inwards on delete cascade,
  variant_id    uuid references variants on delete set null,
  qty_expected  integer not null default 0,
  qty_received  integer not null default 0,
  condition     text, note text
);
create index on goods_inwards_lines (org_id);
create index on goods_inwards_lines (gi_id);

create table goods_outwards (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organisations on delete cascade,
  from_location_id uuid not null references locations on delete restrict,
  to_location_id   uuid references locations on delete set null,
  dispatch_method  text not null default 'ship'
                     check (dispatch_method in ('ship','collect')),
  status           text not null default 'draft'
                     check (status in ('draft','ready','sent','collected','cancelled')),
  created_by       uuid references profiles,
  dispatched_date  date, notes text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on goods_outwards (org_id);

create table goods_outwards_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  go_id         uuid not null references goods_outwards on delete cascade,
  variant_id    uuid references variants on delete set null,
  qty           integer not null check (qty > 0)
);
create index on goods_outwards_lines (org_id);
create index on goods_outwards_lines (go_id);

create table inventory_levels (
  org_id        uuid not null references organisations on delete cascade,
  variant_id    uuid not null references variants on delete cascade,
  location_id   uuid not null references locations on delete cascade,
  on_hand       integer not null default 0,
  committed     integer not null default 0,
  incoming      integer not null default 0,
  reorder_point integer,
  updated_at    timestamptz not null default now(),
  primary key (variant_id, location_id)
);
create index on inventory_levels (org_id);

create table inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  variant_id    uuid not null references variants on delete restrict,
  location_id   uuid not null references locations on delete restrict,
  delta         integer not null,
  reason        text not null
                  check (reason in ('goods_inwards','goods_outwards','transfer_in',
                                    'transfer_out','adjustment','sale','return','count')),
  reference_type text, reference_id uuid, note text,
  created_by    uuid references profiles,
  created_at    timestamptz not null default now()
);
create index on inventory_movements (org_id);
create index on inventory_movements (variant_id, location_id);
create index on inventory_movements (reference_type, reference_id);

create table sales_channels (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  name          text not null,
  platform      text not null
                  check (platform in ('bigcommerce','lightspeed','shopify','manual')),
  external_ref  text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index on sales_channels (org_id);

create table customers (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  email text, first_name text, last_name text, phone text, notes text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on customers (org_id);
create unique index on customers (org_id, lower(email)) where email is not null;

create table orders (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations on delete cascade,
  channel_id        uuid references sales_channels on delete set null,
  external_order_id text, order_number text,
  customer_id       uuid references customers on delete set null,
  status text, financial_status text, order_date timestamptz,
  total             numeric(12,2) not null default 0,
  raw               jsonb,
  created_at        timestamptz not null default now()
);
create index on orders (org_id);
create index on orders (customer_id);
create index on orders (order_number);
create unique index on orders (org_id, channel_id, external_order_id)
  where external_order_id is not null;

create table order_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  order_id      uuid not null references orders on delete cascade,
  variant_id    uuid references variants on delete set null,
  sku text, name text,
  qty           integer not null default 1,
  unit_price    numeric(12,2) not null default 0
);
create index on order_lines (org_id);
create index on order_lines (order_id);

create table returns (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations on delete cascade,
  rma_number            text not null,
  order_id              uuid references orders on delete set null,
  order_number          text,
  customer_id           uuid references customers on delete set null,
  returned_to_location_id uuid references locations on delete set null,
  return_date           date not null default current_date,
  reason                text,
  status                text not null default 'requested'
                          check (status in ('requested','approved','received',
                                            'refunded','rejected')),
  logged_by             uuid references profiles,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, rma_number)
);
create index on returns (org_id);

create table return_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  return_id     uuid not null references returns on delete cascade,
  order_line_id uuid references order_lines on delete set null,
  variant_id    uuid references variants on delete set null,
  qty           integer not null check (qty > 0),
  condition     text check (condition in ('resalable','damaged','faulty'))
);
create index on return_lines (org_id);
create index on return_lines (return_id);

create table import_templates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  supplier_id   uuid not null references suppliers on delete cascade,
  name          text not null,
  source_format text not null default 'excel'
                  check (source_format in ('excel','csv','pdf')),
  column_config jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on import_templates (org_id);
create index on import_templates (supplier_id);

create table export_mappings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  supplier_id   uuid references suppliers on delete cascade,
  target        text not null check (target in ('lightspeed','warehouse')),
  mapping       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on export_mappings (org_id);
create index on export_mappings (supplier_id, target);

create table integration_settings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations on delete cascade,
  provider        text not null
                    check (provider in ('bigcommerce','lightspeed','shopify')),
  config          jsonb not null default '{}'::jsonb,
  vault_secret_id uuid,
  is_active       boolean not null default false,
  updated_by      uuid references profiles,
  updated_at      timestamptz not null default now(),
  unique (org_id, provider)
);
create index on integration_settings (org_id);

create table attachments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  entity_type   text not null,
  entity_id     uuid not null,
  file_url      text not null,
  file_name     text,
  uploaded_by   uuid references profiles,
  created_at    timestamptz not null default now()
);
create index on attachments (org_id);
create index on attachments (entity_type, entity_id);

create table activity_log (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  actor_id      uuid references profiles on delete set null,
  action        text not null,
  entity_type   text not null,
  entity_id     uuid not null,
  detail        jsonb,
  created_at    timestamptz not null default now()
);
create index on activity_log (org_id);
create index on activity_log (entity_type, entity_id, created_at);

-- ===== SIGNUP / INVITE FLOWS ================================================
-- Creates an organisation and makes the caller its owner. Runs as definer so a
-- user with no org yet can still insert the first row.
create or replace function create_organisation(org_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  if (select org_id from profiles where id = auth.uid()) is not null then
    raise exception 'You already belong to an organisation.';
  end if;

  insert into organisations (name) values (org_name) returning id into new_org;

  update profiles
     set org_id = new_org, role = 'owner', updated_at = now()
   where id = auth.uid();

  return new_org;
end $$;

-- Accepts an invitation by token and joins the caller to that organisation.
create or replace function accept_invitation(invite_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv org_invitations;
begin
  select * into inv from org_invitations
   where token = invite_token and status = 'pending';

  if inv is null then
    raise exception 'That invitation is not valid or has already been used.';
  end if;

  update profiles
     set org_id = inv.org_id,
         role = inv.role,
         supplier_id = inv.supplier_id,
         updated_at = now()
   where id = auth.uid();

  update org_invitations
     set status = 'accepted', accepted_at = now()
   where id = inv.id;

  return inv.org_id;
end $$;

-- ===== updated_at triggers ==================================================
do $$
declare t text;
begin
  foreach t in array array[
    'organisations','suppliers','locations','profiles','products','variants',
    'purchase_orders','shipments','goods_outwards','customers','returns',
    'import_templates','export_mappings'
  ] loop
    execute format('create trigger %I_set_updated_at before update on %I
      for each row execute function set_updated_at();', t, t);
  end loop;
end $$;

-- ===== ROW LEVEL SECURITY ===================================================
-- Every business table: you can only touch rows in your own organisation.
do $$
declare t text;
begin
  foreach t in array array[
    'suppliers','locations','brands','products','variants','purchase_orders',
    'purchase_order_lines','po_allocations','shipments','shipment_lines',
    'goods_inwards','goods_inwards_lines','goods_outwards','goods_outwards_lines',
    'inventory_levels','inventory_movements','sales_channels','customers',
    'orders','order_lines','returns','return_lines','import_templates',
    'export_mappings','integration_settings','attachments','activity_log'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "org members" on %I for all to authenticated
         using (org_id = current_org_id())
         with check (org_id = current_org_id());', t);
  end loop;
end $$;

-- Organisations: members read their own; owners/admins update it.
alter table organisations enable row level security;

create policy "read own org" on organisations
  for select to authenticated using (id = current_org_id());

create policy "owners update org" on organisations
  for update to authenticated
  using (id = current_org_id() and has_org_role(array['owner','admin']))
  with check (id = current_org_id());

-- Profiles: always read your own row (needed to resolve org + role at login),
-- read colleagues in your org, and let owners/admins manage them.
alter table profiles enable row level security;

create policy "read own profile" on profiles
  for select to authenticated using (id = auth.uid());

create policy "read org profiles" on profiles
  for select to authenticated using (org_id = current_org_id());

create policy "update own profile" on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "admins manage profiles" on profiles
  for update to authenticated
  using (org_id = current_org_id() and has_org_role(array['owner','admin']))
  with check (org_id = current_org_id());

-- Invitations: managed by owners/admins of the org.
alter table org_invitations enable row level security;

create policy "admins manage invites" on org_invitations
  for all to authenticated
  using (org_id = current_org_id() and has_org_role(array['owner','admin']))
  with check (org_id = current_org_id() and has_org_role(array['owner','admin']));
