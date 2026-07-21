// Handles integration credentials server side.
//
// The browser never sees or stores API keys: it posts them here, we verify the
// caller is a signed in owner/admin of the organisation, then write them to a
// table the browser cannot read. Testing a connection also happens here, so the
// keys never leave the server.
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ---------------------------------------------------------------------------
// Per platform connection tests. Each returns { ok, error } and never returns
// the credentials themselves.
// ---------------------------------------------------------------------------
async function testConnection(provider, variant, creds) {
  try {
    if (provider === 'shopify') {
      const shop = (creds.shop_domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
      const res = await fetch(`https://${shop}/admin/api/2024-10/shop.json`, {
        headers: { 'X-Shopify-Access-Token': creds.access_token },
      })
      if (!res.ok) return { ok: false, error: `Shopify replied ${res.status}. Check the store domain and access token.` }
      return { ok: true }
    }

    if (provider === 'bigcommerce') {
      const res = await fetch(
        `https://api.bigcommerce.com/stores/${creds.store_hash}/v2/store`,
        {
          headers: {
            'X-Auth-Token': creds.access_token,
            Accept: 'application/json',
          },
        }
      )
      if (!res.ok) return { ok: false, error: `BigCommerce replied ${res.status}. Check the store hash and access token.` }
      return { ok: true }
    }

    if (provider === 'lightspeed') {
      if (variant === 'xseries') {
        const domain = (creds.domain_prefix || '').replace(/\.retail\.lightspeed\.app$/, '')
        const res = await fetch(`https://${domain}.retail.lightspeed.app/api/2.0/outlets`, {
          headers: { Authorization: `Bearer ${creds.access_token}` },
        })
        if (!res.ok) return { ok: false, error: `Lightspeed replied ${res.status}. Check the domain prefix and token.` }
        return { ok: true }
      }
      // R-Series
      const res = await fetch(
        `https://api.lightspeedapp.com/API/V3/Account/${creds.account_id}/Shop.json`,
        { headers: { Authorization: `Bearer ${creds.access_token}` } }
      )
      if (!res.ok) return { ok: false, error: `Lightspeed replied ${res.status}. Check the account ID and token.` }
      return { ok: true }
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Could not reach ${provider}: ${err.message}` }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({
      error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
    })
  }

  // --- who is calling? -----------------------------------------------------
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  if (!token) return res.status(401).json({ error: 'Not signed in.' })

  const sb = admin()
  const { data: userData, error: userErr } = await sb.auth.getUser(token)
  if (userErr || !userData?.user) return res.status(401).json({ error: 'Not signed in.' })

  const { data: profile } = await sb
    .from('profiles')
    .select('id, org_id, role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (!profile?.org_id || !profile.is_active) {
    return res.status(403).json({ error: 'You are not part of an active business.' })
  }
  if (!['owner', 'admin'].includes(profile.role)) {
    return res.status(403).json({ error: 'Only an owner or admin can manage connections.' })
  }

  const { action, provider, variant, credentials, config } = req.body || {}
  const allowed = ['bigcommerce', 'lightspeed', 'shopify', 'other']
  if (!allowed.includes(provider)) {
    return res.status(400).json({ error: 'Unknown provider.' })
  }

  const orgId = profile.org_id

  try {
    // --- disconnect --------------------------------------------------------
    if (action === 'disconnect') {
      await sb.from('integration_secrets').delete().match({ org_id: orgId, provider })
      await sb.from('integration_settings').upsert(
        {
          org_id: orgId,
          provider,
          is_active: false,
          status: 'not_connected',
          last_error: null,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'org_id,provider' }
      )
      return res.status(200).json({ ok: true, status: 'not_connected' })
    }

    // --- test an existing connection ---------------------------------------
    if (action === 'test') {
      const { data: secret } = await sb
        .from('integration_secrets')
        .select('credentials')
        .match({ org_id: orgId, provider })
        .maybeSingle()

      if (!secret) return res.status(400).json({ error: 'Nothing connected yet.' })

      const { data: setting } = await sb
        .from('integration_settings')
        .select('variant')
        .match({ org_id: orgId, provider })
        .maybeSingle()

      const result = await testConnection(provider, setting?.variant, secret.credentials)

      await sb.from('integration_settings').upsert(
        {
          org_id: orgId,
          provider,
          status: result.ok ? 'connected' : 'error',
          is_active: result.ok,
          last_tested_at: new Date().toISOString(),
          last_error: result.ok ? null : result.error,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'org_id,provider' }
      )

      return res.status(200).json({
        ok: result.ok,
        status: result.ok ? 'connected' : 'error',
        error: result.error ?? null,
      })
    }

    // --- save / connect ----------------------------------------------------
    if (action === 'save') {
      if (!credentials || typeof credentials !== 'object') {
        return res.status(400).json({ error: 'No credentials supplied.' })
      }

      const result = await testConnection(provider, variant, credentials)

      // Store even when the test fails, so a typo can be corrected without
      // retyping everything - but mark it as errored.
      await sb.from('integration_secrets').upsert(
        {
          org_id: orgId,
          provider,
          credentials,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'org_id,provider' }
      )

      await sb.from('integration_settings').upsert(
        {
          org_id: orgId,
          provider,
          variant: variant ?? null,
          config: config ?? {},
          is_active: result.ok,
          status: result.ok ? 'connected' : 'error',
          last_tested_at: new Date().toISOString(),
          last_error: result.ok ? null : result.error,
          connected_by: profile.id,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'org_id,provider' }
      )

      return res.status(200).json({
        ok: result.ok,
        status: result.ok ? 'connected' : 'error',
        error: result.error ?? null,
      })
    }

    return res.status(400).json({ error: 'Unknown action.' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
