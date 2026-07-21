import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Builds a link into the sales platform's admin for a given order.
const BUILDERS = {
  bigcommerce: (cfg, extId) =>
    cfg?.store_hash
      ? `https://store-${cfg.store_hash}.mybigcommerce.com/manage/orders/${extId}`
      : null,
  shopify: (cfg, extId) =>
    cfg?.shop_domain ? `https://${cfg.shop_domain}/admin/orders/${extId}` : null,
}

export function orderAdminUrl(configs, platform, externalId) {
  if (!platform || !externalId) return null
  const build = BUILDERS[platform]
  return build ? build(configs?.[platform], externalId) : null
}

// Loads the non secret config for each connected platform once, keyed by
// provider, so pages can build admin links.
export function useIntegrationConfigs() {
  const [configs, setConfigs] = useState({})

  useEffect(() => {
    supabase
      .from('integration_settings')
      .select('provider, config')
      .then(({ data }) => {
        const map = {}
        for (const row of data ?? []) map[row.provider] = row.config ?? {}
        setConfigs(map)
      })
  }, [])

  return configs
}
