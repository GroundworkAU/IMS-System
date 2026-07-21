import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { platformInfo } from '../lib/platforms'

// Choose which brands a platform should bring across. Empty means everything.
// Stored on integration_settings.config so the sync can read it server side.
export default function SyncFilters({ orgId, providers }) {
  const [brands, setBrands] = useState([])
  const [configs, setConfigs] = useState({})
  const [saving, setSaving] = useState(null)
  const [status, setStatus] = useState(null)

  const load = useCallback(async () => {
    const [b, p, s] = await Promise.all([
      supabase.from('brands').select('name').order('name'),
      supabase.from('products').select('external_brand').not('external_brand', 'is', null).limit(2000),
      supabase.from('integration_settings').select('provider, config'),
    ])

    const names = new Set()
    for (const row of b.data ?? []) if (row.name) names.add(row.name)
    for (const row of p.data ?? []) if (row.external_brand) names.add(row.external_brand)
    setBrands([...names].sort((x, y) => x.localeCompare(y)))

    const map = {}
    for (const row of s.data ?? []) map[row.provider] = row.config ?? {}
    setConfigs(map)
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle(provider, brand) {
    const current = configs[provider]?.sync_brands ?? []
    const next = current.includes(brand)
      ? current.filter((b) => b !== brand)
      : [...current, brand]
    await save(provider, next)
  }

  async function save(provider, list) {
    setSaving(provider)
    const merged = { ...(configs[provider] ?? {}), sync_brands: list }
    const { error } = await supabase
      .from('integration_settings')
      .upsert({ org_id: orgId, provider, config: merged }, { onConflict: 'org_id,provider' })
    setSaving(null)
    if (error) setStatus({ type: 'err', text: error.message })
    else {
      setConfigs({ ...configs, [provider]: merged })
      setStatus({
        type: 'ok',
        text: list.length
          ? `Next sync will bring in ${list.length} brand${list.length === 1 ? '' : 's'} only.`
          : 'Next sync will bring in everything.',
      })
    }
  }

  if (providers.length === 0) return null

  return (
    <div>
      <p className="page-desc" style={{ marginBottom: 14 }}>
        By default a sync brings in the whole catalogue. Pick brands to narrow it ~ useful when
        a platform holds far more than you need to manage here, and it makes syncs quicker.
      </p>

      {status && (
        <div className={'auth-msg ' + (status.type === 'ok' ? 'ok' : 'err')} style={{ marginBottom: 14 }}>
          {status.text}
        </div>
      )}

      {brands.length === 0 ? (
        <div className="placeholder-note">
          No brands known yet. Sync once, or import brands, and they will appear here to choose from.
        </div>
      ) : (
        providers.map((provider) => {
          const chosen = configs[provider]?.sync_brands ?? []
          return (
            <div key={provider} className="sync-filter">
              <div className="sync-filter-head">
                <span className="cell-strong">{platformInfo(provider).label}</span>
                <span className="cell-sub">
                  {chosen.length === 0
                    ? 'Everything'
                    : `${chosen.length} brand${chosen.length === 1 ? '' : 's'} selected`}
                  {chosen.length > 0 && (
                    <button
                      className="linklike"
                      style={{ marginLeft: 10 }}
                      onClick={() => save(provider, [])}
                      disabled={saving === provider}
                    >
                      Bring in everything
                    </button>
                  )}
                </span>
              </div>

              <div className="loc-chips">
                {brands.map((b) => {
                  const on = chosen.includes(b)
                  return (
                    <button
                      key={b}
                      className={'loc-chip' + (on ? ' on' : '')}
                      disabled={saving === provider}
                      onClick={() => toggle(provider, b)}
                    >
                      {b}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
