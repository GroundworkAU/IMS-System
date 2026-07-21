-- ============================================================================
-- IMS System — 0017: readable, sequential reference numbers
--
-- Replaces timestamp based references (REQ-M8XK2P) with something a person can
-- read out over the phone (RS-0042). Each business sets its own prefix per
-- record type, and numbering is handed out under a row lock so two people
-- raising something at the same moment cannot collide.
-- ============================================================================

create table if not exists reference_counters (
  org_id      uuid not null references organisations on delete cascade,
  kind        text not null
                check (kind in ('restock_request','restock_order','return','issue')),
  prefix      text not null default '',
  padding     integer not null default 4,
  next_number integer not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (org_id, kind)
);

alter table reference_counters enable row level security;

drop policy if exists "org members" on reference_counters;
create policy "org members" on reference_counters
  for all to authenticated
  using (org_id = current_org_id())
  with check (org_id = current_org_id());

-- Hands out the next reference for a given kind, creating the counter on first
-- use. FOR UPDATE serialises concurrent callers.
create or replace function next_reference(p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := current_org_id();
  v_prefix text;
  v_padding integer;
  v_number integer;
begin
  if v_org is null then
    raise exception 'You are not part of a business.';
  end if;

  insert into reference_counters (org_id, kind, prefix)
  values (
    v_org,
    p_kind,
    case p_kind
      when 'restock_request' then 'RS-'
      when 'restock_order'   then 'RO-'
      when 'return'          then 'RMA-'
      when 'issue'           then 'ISS-'
      else ''
    end
  )
  on conflict (org_id, kind) do nothing;

  select prefix, padding, next_number
    into v_prefix, v_padding, v_number
    from reference_counters
   where org_id = v_org and kind = p_kind
     for update;

  update reference_counters
     set next_number = next_number + 1, updated_at = now()
   where org_id = v_org and kind = p_kind;

  return v_prefix || lpad(v_number::text, v_padding, '0');
end $$;
