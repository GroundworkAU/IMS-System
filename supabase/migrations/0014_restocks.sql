-- ============================================================================
-- IMS System — 0014: restock requests and restock orders
--
-- Flow:
--   1. Someone raises a restock REQUEST for a location ~ a wish list, it moves
--      no stock.
--   2. Whoever holds the stock fulfils what they can, choosing the source
--      location. That creates a restock ORDER for the quantities agreed.
--   3. From the order, a goods inwards is sent to the warehouse, and (later) a
--      transfer is created in Lightspeed. Neither moves stock until the
--      warehouse checks the goods inwards off.
--   4. Anything received short or over is flagged so the sender can correct it.
--
-- Lines carry sku and name as text as well as an optional variant_id, so
-- requests can be raised before the product catalogue is synced.
-- ============================================================================

create table if not exists restock_requests (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references organisations on delete cascade,
  reference               text not null,
  destination_location_id uuid references locations on delete set null,
  status                  text not null default 'open'
                            check (status in ('open','partly_fulfilled','fulfilled','cancelled')),
  note                    text,
  requested_by            uuid references profiles on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (org_id, reference)
);
create index if not exists restock_requests_org_idx on restock_requests (org_id);

create table if not exists restock_request_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  request_id    uuid not null references restock_requests on delete cascade,
  variant_id    uuid references variants on delete set null,
  sku           text,
  name          text not null,
  qty_requested integer not null check (qty_requested > 0),
  qty_fulfilled integer not null default 0,
  note          text
);
create index if not exists restock_request_lines_req_idx on restock_request_lines (request_id);

create table if not exists restock_orders (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references organisations on delete cascade,
  reference               text not null,
  request_id              uuid references restock_requests on delete set null,
  source_location_id      uuid references locations on delete set null,
  destination_location_id uuid references locations on delete set null,
  status                  text not null default 'draft'
                            check (status in ('draft','sent','received','discrepancy','closed','cancelled')),
  note                    text,
  fulfilled_by            uuid references profiles on delete set null,
  -- set once a transfer has been raised on the point of sale
  external_transfer_id    text,
  external_transfer_at    timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (org_id, reference)
);
create index if not exists restock_orders_org_idx on restock_orders (org_id);

create table if not exists restock_order_lines (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations on delete cascade,
  order_id        uuid not null references restock_orders on delete cascade,
  request_line_id uuid references restock_request_lines on delete set null,
  variant_id      uuid references variants on delete set null,
  sku             text,
  name            text not null,
  qty_sent        integer not null check (qty_sent > 0),
  qty_received    integer,
  note            text
);
create index if not exists restock_order_lines_order_idx on restock_order_lines (order_id);

-- Tie a goods inwards back to the restock order that produced it.
alter table goods_inwards
  add column if not exists restock_order_id uuid references restock_orders on delete set null;

create trigger restock_requests_set_updated_at
  before update on restock_requests
  for each row execute function set_updated_at();

create trigger restock_orders_set_updated_at
  before update on restock_orders
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array[
    'restock_requests','restock_request_lines','restock_orders','restock_order_lines'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "org members" on %I;', t);
    execute format(
      'create policy "org members" on %I for all to authenticated
         using (org_id = current_org_id())
         with check (org_id = current_org_id());', t);
  end loop;
end $$;
