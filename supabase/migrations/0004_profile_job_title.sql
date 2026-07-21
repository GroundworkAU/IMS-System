-- ============================================================================
-- IMS System — 0004: capture job title / position on the profile
-- ============================================================================

alter table profiles add column if not exists job_title text;

-- Carry full name and job title through from signup metadata.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email, job_title)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.email,
    new.raw_user_meta_data ->> 'job_title'
  );
  return new;
end $$;
