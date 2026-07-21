-- ============================================================================
-- IMS System — 0008: integration credentials, stored safely
--
-- integration_settings  : non secret config (store domain, variant, status).
--                         Readable by the org so the UI can show connection state.
-- integration_secrets   : the actual API keys. RLS is ENABLED WITH NO POLICIES,
--                         which means no browser client can read or write it at
--                         all, ever. Only the service role (used by our /api
--                         functions, server side) can touch it.
-- ============================================================================

alter table integration_settings
  add column if not exists variant text,
  add column if not exists status text not null default 'not_connected'
    check (status in ('not_connected','connected','error')),
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_error text,
  add column if not exists connected_by uuid references profiles on delete set null;

-- Allow 'other' as a provider alongside the named platforms.
alter table integration_settings drop constraint if exists integration_settings_provider_check;
alter table integration_settings
  add constraint integration_settings_provider_check
  check (provider in ('bigcommerce','lightspeed','shopify','other'));

create table if not exists integration_secrets (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations on delete cascade,
  provider      text not null,
  credentials   jsonb not null,
  updated_at    timestamptz not null default now(),
  unique (org_id, provider)
);

-- Enabled, with no policies: unreachable from the browser by design.
alter table integration_secrets enable row level security;

revoke all on integration_secrets from anon, authenticated;
