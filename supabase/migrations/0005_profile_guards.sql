-- ============================================================================
-- IMS System — 0005: stop users escalating their own access
--
-- The "update own profile" policy lets a user edit their own row, which would
-- otherwise let them set role = 'owner' or move themselves into another
-- organisation by calling the API directly. This trigger locks both fields:
--
--   * org_id may only be set when it is currently null (joining a business
--     for the first time, via create_organisation or accept_invitation)
--   * role may only be changed by an owner or admin of the same organisation,
--     and never on your own row
-- ============================================================================

create or replace function guard_profile_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare caller_role text;
begin
  -- Allow anything when there is no authenticated user (service role, triggers,
  -- SQL editor, seeding).
  if auth.uid() is null then
    return new;
  end if;

  -- Organisation can only be set once, never moved.
  if new.org_id is distinct from old.org_id and old.org_id is not null then
    raise exception 'You cannot move a user to a different business.';
  end if;

  if new.role is distinct from old.role then
    if old.org_id is null then
      -- Initial assignment on joining: allowed.
      return new;
    end if;

    if new.id = auth.uid() then
      raise exception 'You cannot change your own access level.';
    end if;

    select role into caller_role from profiles where id = auth.uid();

    if caller_role is null or caller_role not in ('owner','admin') then
      raise exception 'Only an owner or admin can change access levels.';
    end if;

    -- Only an owner may grant or remove owner access.
    if (new.role = 'owner' or old.role = 'owner') and caller_role <> 'owner' then
      raise exception 'Only an owner can change owner access.';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists profiles_guard_changes on profiles;

create trigger profiles_guard_changes
  before update on profiles
  for each row execute function guard_profile_changes();
