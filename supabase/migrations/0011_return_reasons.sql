-- ============================================================================
-- IMS System — 0011: return reasons a business manages itself
-- ============================================================================

create table if not exists return_reasons (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations on delete cascade,
  label       text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (org_id, label)
);
create index if not exists return_reasons_org_idx on return_reasons (org_id);

alter table return_reasons enable row level security;

drop policy if exists "org members" on return_reasons;
create policy "org members" on return_reasons
  for all to authenticated
  using (org_id = current_org_id())
  with check (org_id = current_org_id());
