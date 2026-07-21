import { supabase } from './supabase'

// Credential fields per platform. Nothing here is stored in the browser ~ these
// only describe what to ask for.
export const CREDENTIAL_FIELDS = {
  lightspeed: {
    variants: [
      { value: 'xseries', label: 'Lightspeed Retail (X-Series)' },
      { value: 'rseries', label: 'Lightspeed Retail (R-Series)' },
    ],
    fields: {
      xseries: [
        {
          key: 'domain_prefix',
          label: 'Domain prefix',
          hint: 'The part before .retail.lightspeed.app in your admin address.',
        },
        { key: 'access_token', label: 'Personal access token', secret: true },
      ],
      rseries: [
        { key: 'account_id', label: 'Account ID' },
        { key: 'access_token', label: 'Access token', secret: true },
      ],
    },
  },
  bigcommerce: {
    fields: {
      default: [
        {
          key: 'store_hash',
          label: 'Store hash',
          hint: 'Found in your BigCommerce API account details.',
        },
        { key: 'access_token', label: 'Access token', secret: true },
      ],
    },
  },
  shopify: {
    fields: {
      default: [
        {
          key: 'shop_domain',
          label: 'Store domain',
          hint: 'For example your-store.myshopify.com',
        },
        { key: 'access_token', label: 'Admin API access token', secret: true },
      ],
    },
  },
}

export function fieldsFor(provider, variant) {
  const def = CREDENTIAL_FIELDS[provider]
  if (!def) return []
  if (def.variants) return def.fields[variant] ?? def.fields[def.variants[0].value] ?? []
  return def.fields.default ?? []
}

export function variantsFor(provider) {
  return CREDENTIAL_FIELDS[provider]?.variants ?? null
}

// Calls our serverless endpoint with the current session token.
export async function callIntegrations(payload) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) return { ok: false, error: 'Your session has expired. Sign in again.' }

  const res = await fetch('/api/integrations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  let body = {}
  try { body = await res.json() } catch { /* non JSON response */ }

  if (!res.ok) return { ok: false, error: body.error || `Request failed (${res.status}).` }
  return body
}

// Ask a connected platform for its locations / outlets.
export async function fetchPlatformLocations(provider) {
  return callIntegrations({ action: 'locations', provider })
}
