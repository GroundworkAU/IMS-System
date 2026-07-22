-- ============================================================================
-- IMS System — 0027: one order, several files, split by destination
--
-- Suppliers often send a separate confirmation per destination: the same
-- products, different quantities. Each file is imported into the same order and
-- tagged with where its stock is going, so the order line holds the total and
-- po_allocations holds the split.
--
-- A file with no destination is treated as unallocated ~ the total is known but
-- not yet divided up.
-- ============================================================================

alter table po_allocations drop constraint if exists po_allocations_line_location_key;
alter table po_allocations
  add constraint po_allocations_line_location_key unique (po_line_id, location_id);

create table if not exists po_imports (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organisations on delete cascade,
  po_id        uuid not null references purchase_orders on delete cascade,
  file_name    text,
  sheets       text,
  location_id  uuid references locations on delete set null,   -- null = unallocated
  line_count   integer not null default 0,
  unit_count   integer not null default 0,
  imported_by  uuid references profiles on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists po_imports_po_idx on po_imports (po_id);

alter table po_imports enable row level security;

drop policy if exists "org members" on po_imports;
create policy "org members" on po_imports
  for all to authenticated
  using (org_id = current_org_id())
  with check (org_id = current_org_id());
