-- ============================================================================
-- IMS System — 0012: order issues
--
-- Mirrors returns: the warehouse or the team raises an issue against a real
-- order, picks a reason, and (only when the reason calls for it) says which
-- items are affected. Address, phone and email problems need no items.
-- ============================================================================

create table if not exists issue_reasons (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organisations on delete cascade,
  label          text not null,
  -- when true, whoever raises the issue must pick the affected items
  requires_items boolean not null default false,
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (org_id, label)
);
create index if not exists issue_reasons_org_idx on issue_reasons (org_id);

create table if not exists order_issues (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations on delete cascade,
  reference       text not null,
  order_id        uuid references orders on delete set null,
  order_number    text,
  reason          text not null,
  detail          text,
  status          text not null default 'open'
                    check (status in ('open','resolved','cancelled')),
  raised_by       uuid references profiles on delete set null,
  resolved_by     uuid references profiles on delete set null,
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, reference)
);
create index if not exists order_issues_org_idx on order_issues (org_id);
create index if not exists order_issues_status_idx on order_issues (status);

create table if not exists order_issue_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  issue_id      uuid not null references order_issues on delete cascade,
  order_line_id uuid references order_lines on delete set null,
  variant_id    uuid references variants on delete set null,
  qty           integer,
  note          text
);
create index if not exists order_issue_lines_issue_idx on order_issue_lines (issue_id);

create trigger order_issues_set_updated_at
  before update on order_issues
  for each row execute function set_updated_at();

-- RLS: same org scoping as everything else.
do $$
declare t text;
begin
  foreach t in array array['issue_reasons','order_issues','order_issue_lines'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "org members" on %I;', t);
    execute format(
      'create policy "org members" on %I for all to authenticated
         using (org_id = current_org_id())
         with check (org_id = current_org_id());', t);
  end loop;
end $$;
