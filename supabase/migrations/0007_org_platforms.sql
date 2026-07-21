-- ============================================================================
-- IMS System — 0007: which platforms does this business use?
--
-- Captured at signup and editable in Settings. Drives which platform specific
-- fields appear elsewhere (e.g. a location only asks for a Lightspeed outlet
-- reference if the business actually uses Lightspeed).
--
-- Locations move from a single external_ref to a keyed set of references, so a
-- business running more than one platform can map each location to each.
-- ============================================================================

alter table organisations
  add column if not exists platforms text[] not null default '{}';

alter table locations
  add column if not exists external_refs jsonb not null default '{}'::jsonb;

-- Carry any existing single reference across as the Lightspeed one.
update locations
   set external_refs = jsonb_build_object('lightspeed', external_ref)
 where external_ref is not null
   and external_ref <> ''
   and external_refs = '{}'::jsonb;

-- create_organisation now records the platforms chosen at signup.
drop function if exists create_organisation(text);

create or replace function create_organisation(org_name text, org_platforms text[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  if (select org_id from profiles where id = auth.uid()) is not null then
    raise exception 'You already belong to an organisation.';
  end if;

  insert into organisations (name, platforms)
  values (org_name, coalesce(org_platforms, '{}'))
  returning id into new_org;

  update profiles
     set org_id = new_org, role = 'owner', updated_at = now()
   where id = auth.uid();

  return new_org;
end $$;
