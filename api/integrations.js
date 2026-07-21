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

// ---------------------------------------------------------------------------
// Fetch the locations / outlets a platform knows about, so a user can pick one
// from a list instead of typing an id. Returns [{ id, name }].
// ---------------------------------------------------------------------------
async function fetchRemoteLocations(provider, variant, creds) {
  if (provider === 'shopify') {
    const shop = (creds.shop_domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
    const res = await fetch(`https://${shop}/admin/api/2024-10/locations.json`, {
      headers: { 'X-Shopify-Access-Token': creds.access_token },
    })
    if (!res.ok) throw new Error(`Shopify replied ${res.status}.`)
    const body = await res.json()
    return (body.locations ?? []).map((l) => ({
      id: String(l.id),
      name: l.name,
      detail: [l.city, l.province, l.country_code].filter(Boolean).join(', '),
    }))
  }

  if (provider === 'bigcommerce') {
    const res = await fetch(
      `https://api.bigcommerce.com/stores/${creds.store_hash}/v3/inventory/locations`,
      { headers: { 'X-Auth-Token': creds.access_token, Accept: 'application/json' } }
    )
    // Multi location inventory is not enabled on every plan.
    if (res.status === 404 || res.status === 403) {
      return { unsupported: true, locations: [] }
    }
    if (!res.ok) throw new Error(`BigCommerce replied ${res.status}.`)
    const body = await res.json()
    return (body.data ?? []).map((l) => ({
      id: String(l.id),
      name: l.label || l.name || l.code || `Location ${l.id}`,
      detail: l.code ?? '',
    }))
  }

  if (provider === 'lightspeed') {
    if (variant === 'xseries') {
      const domain = (creds.domain_prefix || '').replace(/\.retail\.lightspeed\.app$/, '')
      const res = await fetch(`https://${domain}.retail.lightspeed.app/api/2.0/outlets`, {
        headers: { Authorization: `Bearer ${creds.access_token}` },
      })
      if (!res.ok) throw new Error(`Lightspeed replied ${res.status}.`)
      const body = await res.json()
      return (body.data ?? []).map((o) => ({
        id: String(o.id),
        name: o.name,
        detail: [o.physical_city, o.physical_state].filter(Boolean).join(', '),
      }))
    }
    const res = await fetch(
      `https://api.lightspeedapp.com/API/V3/Account/${creds.account_id}/Shop.json`,
      { headers: { Authorization: `Bearer ${creds.access_token}` } }
    )
    if (!res.ok) throw new Error(`Lightspeed replied ${res.status}.`)
    const body = await res.json()
    const shops = Array.isArray(body.Shop) ? body.Shop : body.Shop ? [body.Shop] : []
    return shops.map((s) => ({ id: String(s.shopID), name: s.name, detail: '' }))
  }

  return []
}

// ---------------------------------------------------------------------------
// Order sync. Headers only: line items are fetched on demand when someone opens
// an order, which keeps the sync fast and avoids a request per order.
// ---------------------------------------------------------------------------
async function bcFetch(creds, path) {
  const res = await fetch(
    `https://api.bigcommerce.com/stores/${creds.store_hash}${path}`,
    { headers: { 'X-Auth-Token': creds.access_token, Accept: 'application/json' } }
  )
  if (res.status === 204) return []
  if (!res.ok) throw new Error(`BigCommerce replied ${res.status}.`)
  return res.json()
}

async function syncBigCommerceOrders(sb, orgId, creds, sinceDays = 120) {
  // Make sure we have a channel row to hang orders off.
  let { data: channel } = await sb
    .from('sales_channels')
    .select('id')
    .match({ org_id: orgId, platform: 'bigcommerce' })
    .maybeSingle()

  if (!channel) {
    const { data: created, error } = await sb
      .from('sales_channels')
      .insert({ org_id: orgId, name: 'BigCommerce', platform: 'bigcommerce' })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    channel = created
  }

  let page = 1
  let imported = 0
  let fetched = 0
  const problems = []

  while (page <= 8) {
    const orders = await bcFetch(
      creds,
      `/v2/orders?limit=250&page=${page}&sort=date_created:desc`
    )
    if (!Array.isArray(orders) || orders.length === 0) break

    // Incomplete orders are abandoned carts, not real orders.
    const real = orders.filter(
      (o) => Number(o.status_id) !== 0 && String(o.status || '').toLowerCase() !== 'incomplete'
    )
    fetched += real.length

    for (const o of real) {
      let customerId = null
      const email = (o.billing_address?.email || '').trim().toLowerCase()

      if (email) {
        const { data: existing } = await sb
          .from('customers')
          .select('id')
          .eq('org_id', orgId)
          .ilike('email', email)
          .maybeSingle()

        if (existing) {
          customerId = existing.id
        } else {
          const { data: newCustomer } = await sb
            .from('customers')
            .insert({
              org_id: orgId,
              email,
              first_name: o.billing_address?.first_name ?? null,
              last_name: o.billing_address?.last_name ?? null,
              phone: o.billing_address?.phone ?? null,
            })
            .select('id')
            .single()
          customerId = newCustomer?.id ?? null
        }
      }

      const { error: orderErr } = await sb.from('orders').upsert(
        {
          org_id: orgId,
          channel_id: channel.id,
          external_order_id: String(o.id),
          order_number: String(o.id),
          customer_id: customerId,
          status: o.status ?? null,
          financial_status: o.payment_status ?? null,
          order_date: o.date_created ? new Date(o.date_created).toISOString() : null,
          total: Number(o.total_inc_tax ?? 0),
          raw: {
            billing_name: [o.billing_address?.first_name, o.billing_address?.last_name]
              .filter(Boolean).join(' '),
            email: email || null,
            phone: o.billing_address?.phone ?? null,
            items_total: o.items_total ?? null,
            shipping_city: o.billing_address?.city ?? null,
          },
        },
        { onConflict: 'org_id,channel_id,external_order_id' }
      )

      if (orderErr) {
        if (problems.length < 3) problems.push(orderErr.message)
      } else {
        imported += 1
      }
    }

    if (orders.length < 250) break
    page += 1
  }

  // Remove anything previously brought in as an incomplete cart.
  let removedIncomplete = 0
  const { data: binned, error: binErr } = await sb
    .from('orders')
    .delete()
    .eq('org_id', orgId)
    .ilike('status', 'incomplete')
    .select('id')

  if (binErr) problems.push(`Could not clear incomplete orders: ${binErr.message}`)
  else removedIncomplete = binned?.length ?? 0

  // Any open return whose order now shows as refunded on the platform gets
  // marked refunded automatically, so the list reflects reality without anyone
  // having to remember to update it.
  const { data: refundedOrders, error: refErr } = await sb
    .from('orders')
    .select('id')
    .eq('org_id', orgId)
    .ilike('status', '%refunded%')

  if (refErr) problems.push(`Could not check refunds: ${refErr.message}`)

  const refundedIds = (refundedOrders ?? []).map((o) => o.id)
  let autoClosed = 0

  if (refundedIds.length > 0) {
    const { data: updated, error: updErr } = await sb
      .from('returns')
      .update({
        status: 'refunded',
        refunded_at: new Date().toISOString(),
        refund_source: 'platform',
      })
      .eq('org_id', orgId)
      .eq('status', 'open')
      .in('order_id', refundedIds)
      .select('id')

    if (updErr) problems.push(`Could not mark returns refunded: ${updErr.message}`)
    else autoClosed = updated?.length ?? 0
  }

  return {
    imported,
    fetched,
    autoClosed,
    removedIncomplete,
    error: problems.length ? problems[0] : null,
  }
}

async function loadBigCommerceOrderLines(sb, orgId, creds, orderId) {
  const { data: order } = await sb
    .from('orders')
    .select('id, external_order_id')
    .match({ org_id: orgId, id: orderId })
    .maybeSingle()

  if (!order) throw new Error('Order not found.')

  const products = await bcFetch(creds, `/v2/orders/${order.external_order_id}/products`)

  // Replace existing lines so repeat opens do not duplicate.
  await sb.from('order_lines').delete().match({ org_id: orgId, order_id: order.id })

  const rows = (Array.isArray(products) ? products : []).map((p) => ({
    org_id: orgId,
    order_id: order.id,
    sku: p.sku || null,
    name: p.name || 'Item',
    qty: Number(p.quantity ?? 1),
    unit_price: Number(p.price_inc_tax ?? p.base_price ?? 0),
  }))

  if (rows.length === 0) return []

  const { data: inserted, error } = await sb.from('order_lines').insert(rows).select('*')
  if (error) throw new Error(error.message)
  return inserted
}

// ---------------------------------------------------------------------------
// Refund detection. Rather than trusting the order status (which does not
// always change when a refund is issued), ask BigCommerce directly whether any
// refund exists against the order. Only open returns are checked, so this stays
// to a handful of calls.
// ---------------------------------------------------------------------------
async function checkRefundsForOpenReturns(sb, orgId, creds) {
  const { data: open, error } = await sb
    .from('returns')
    .select('id, order_id, orders(external_order_id, status)')
    .eq('org_id', orgId)
    .eq('status', 'open')

  if (error) throw new Error(`Could not read returns: ${error.message}`)

  let checked = 0
  let closed = 0
  const problems = []

  for (const r of open ?? []) {
    const extId = r.orders?.external_order_id
    if (!extId) continue
    checked += 1

    let refunded = String(r.orders?.status || '').toLowerCase().includes('refunded')

    if (!refunded) {
      try {
        const body = await bcFetch(creds, `/v3/orders/${extId}/payment_actions/refunds`)
        const list = Array.isArray(body) ? body : (body?.data ?? [])
        refunded = list.length > 0
      } catch (err) {
        if (problems.length < 3) problems.push(err.message)
        continue
      }
    }

    if (refunded) {
      const { error: uErr } = await sb
        .from('returns')
        .update({
          status: 'refunded',
          refunded_at: new Date().toISOString(),
          refund_source: 'platform',
        })
        .eq('id', r.id)

      if (uErr) {
        if (problems.length < 3) problems.push(`Could not update return: ${uErr.message}`)
      } else {
        closed += 1
      }
    }
  }

  return { checked, closed, error: problems.length ? problems[0] : null }
}

// ---------------------------------------------------------------------------
// Product catalogue sync. Pulls products with their variants and upserts them,
// keyed on the platform's own ids so repeat syncs update rather than duplicate.
// ---------------------------------------------------------------------------
async function syncBigCommerceProducts(sb, orgId, creds, config = {}) {
  const problems = []
  const now = new Date().toISOString()

  // Brand names, so products read properly in the app.
  const brandNames = {}
  try {
    let bPage = 1
    while (bPage <= 4) {
      const body = await bcFetch(creds, `/v3/catalog/brands?limit=250&page=${bPage}`)
      const list = body?.data ?? []
      for (const b of list) brandNames[b.id] = b.name
      if (list.length < 250) break
      bPage += 1
    }
  } catch (err) {
    problems.push(`Could not read brands: ${err.message}`)
  }

  const wanted = (config.sync_brands ?? []).map((b) => String(b).trim().toLowerCase())
  const keepBrand = (name) =>
    wanted.length === 0 || wanted.includes(String(name ?? '').trim().toLowerCase())

  let page = 1
  let products = 0
  let variants = 0
  let skipped = 0

  // Work a page at a time, writing in bulk rather than row by row. Doing a
  // database round trip per product made this take minutes.
  while (page <= 20) {
    const body = await bcFetch(
      creds,
      `/v3/catalog/products?limit=250&page=${page}&include=variants,primary_image`
    )
    const list = body?.data ?? []
    if (list.length === 0) break

    const kept = list.filter((p) => {
      const ok = keepBrand(p.brand_id ? brandNames[p.brand_id] : null)
      if (!ok) skipped += 1
      return ok
    })

    const productRows = kept.map((p) => ({
      org_id: orgId,
      external_source: 'bigcommerce',
      external_id: String(p.id),
      name: p.name,
      description: p.description
        ? String(p.description).replace(/<[^>]*>/g, '').slice(0, 2000)
        : null,
      external_brand: p.brand_id ? (brandNames[p.brand_id] ?? null) : null,
      image_url: p.primary_image?.url_thumbnail ?? null,
      status: p.is_visible === false ? 'draft' : 'active',
      last_synced_at: now,
    }))

    let savedProducts = []
    if (productRows.length) {
      const { data, error: pErr } = await sb
        .from('products')
        .upsert(productRows, { onConflict: 'org_id,external_source,external_id' })
        .select('id, external_id')
      if (pErr) { problems.push(`Products: ${pErr.message}`); break }
      savedProducts = data ?? []
    }
    products += savedProducts.length

    const productIdByExternal = {}
    for (const row of savedProducts) productIdByExternal[row.external_id] = row.id

    const variantRows = []
    for (const p of kept) {
      const productId = productIdByExternal[String(p.id)]
      if (!productId) continue

      const vs = Array.isArray(p.variants) && p.variants.length
        ? p.variants
        : [{ id: `${p.id}-base`, sku: p.sku, price: p.price, cost_price: p.cost_price }]

      for (const v of vs) {
        variantRows.push({
          org_id: orgId,
          product_id: productId,
          external_source: 'bigcommerce',
          external_id: String(v.id),
          sku: v.sku || null,
          option_name: Array.isArray(v.option_values)
            ? v.option_values.map((o) => o.label).join(' / ') || null
            : null,
          barcode: v.upc || v.gtin || null,
          unit_cost: Number(v.cost_price ?? p.cost_price ?? 0),
          retail_price: Number(v.price ?? p.price ?? 0),
          last_synced_at: now,
        })
      }
    }

    if (variantRows.length) {
      const { error: vErr } = await sb
        .from('variants')
        .upsert(variantRows, { onConflict: 'org_id,external_source,external_id' })
      if (vErr) problems.push(`Variants: ${vErr.message}`)
      else variants += variantRows.length
    }

    if (list.length < 250) break
    page += 1
  }

  const stock = await syncBigCommerceInventory(sb, orgId, creds, problems)

  return {
    products,
    variants,
    skipped,
    ...stock,
    error: problems.length ? problems[0] : null,
  }
}

// ---------------------------------------------------------------------------
// Stock. On stores using multi location inventory the catalogue does not carry
// usable levels, so read the Inventory API and map each platform location to
// the IMS location that names BigCommerce as its stock source.
// ---------------------------------------------------------------------------
async function syncBigCommerceInventory(sb, orgId, creds, problems) {
  const { data: locs, error: locErr } = await sb
    .from('locations')
    .select('id, name, external_refs, stock_source')
    .eq('org_id', orgId)
    .eq('stock_source', 'bigcommerce')

  if (locErr) {
    problems.push(`Locations: ${locErr.message}`)
    return { stockRows: 0, stockLocationMissing: true }
  }
  if (!locs || locs.length === 0) {
    return { stockRows: 0, stockLocationMissing: true }
  }

  // BigCommerce location id -> our location id
  const locationByExternal = {}
  for (const l of locs) {
    const ref = l.external_refs?.bigcommerce
    if (ref) locationByExternal[String(ref)] = l.id
  }
  const unmapped = locs.filter((l) => !l.external_refs?.bigcommerce).map((l) => l.name)
  if (unmapped.length) {
    problems.push(
      `These locations have no BigCommerce location chosen: ${unmapped.join(', ')}`
    )
  }
  if (Object.keys(locationByExternal).length === 0) {
    return { stockRows: 0, stockLocationMissing: true }
  }

  // Look variants up by the platform's own id.
  const variantIdByExternal = {}
  let from = 0
  while (from < 20000) {
    const { data: vs, error: vErr } = await sb
      .from('variants')
      .select('id, external_id')
      .eq('org_id', orgId)
      .eq('external_source', 'bigcommerce')
      .range(from, from + 999)
    if (vErr) { problems.push(`Variants lookup: ${vErr.message}`); break }
    for (const v of vs ?? []) variantIdByExternal[v.external_id] = v.id
    if (!vs || vs.length < 1000) break
    from += 1000
  }

  const locationFilter = Object.keys(locationByExternal).join(',')
  const rows = []
  let page = 1

  while (page <= 20) {
    let body
    try {
      body = await bcFetch(
        creds,
        `/v3/inventory/items?limit=1000&page=${page}&location_id:in=${locationFilter}`
      )
    } catch (err) {
      problems.push(`Inventory: ${err.message}`)
      break
    }

    const items = body?.data ?? []
    if (items.length === 0) break

    for (const item of items) {
      const identity = item.identity ?? {}
      const externalVariant = identity.variant_id != null
        ? String(identity.variant_id)
        : `${identity.product_id}-base`

      const variantId = variantIdByExternal[externalVariant]
      const locationId = locationByExternal[String(item.location_id)]
      if (!variantId || !locationId) continue

      rows.push({
        org_id: orgId,
        variant_id: variantId,
        location_id: locationId,
        on_hand: Number(item.total_inventory_onhand ?? item.available_to_sell ?? 0),
        updated_at: new Date().toISOString(),
      })
    }

    if (items.length < 1000) break
    page += 1
  }

  let stockRows = 0
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    const { error: sErr } = await sb
      .from('inventory_levels')
      .upsert(batch, { onConflict: 'variant_id,location_id' })
    if (sErr) { problems.push(`Stock: ${sErr.message}`); break }
    stockRows += batch.length
  }

  return { stockRows, stockLocationMissing: false }
}

// ---------------------------------------------------------------------------
// Lightspeed. Two very different products share the name, so everything here
// dispatches on the variant chosen when the connection was made.
// ---------------------------------------------------------------------------
function lsBase(variant, creds) {
  if (variant === 'xseries') {
    const domain = (creds.domain_prefix || '').replace(/\.retail\.lightspeed\.app$/, '')
    return `https://${domain}.retail.lightspeed.app`
  }
  return `https://api.lightspeedapp.com/API/V3/Account/${creds.account_id}`
}

async function lsFetch(variant, creds, path) {
  const res = await fetch(`${lsBase(variant, creds)}${path}`, {
    headers: {
      Authorization: `Bearer ${creds.access_token}`,
      Accept: 'application/json',
    },
  })
  if (res.status === 204) return null
  if (!res.ok) throw new Error(`Lightspeed replied ${res.status} on ${path}`)
  return res.json()
}

async function syncLightspeedProducts(sb, orgId, variant, creds, config = {}) {
  const problems = []
  const now = new Date().toISOString()

  // Locations that take their stock from Lightspeed, keyed by the outlet/shop
  // id recorded against them.
  const { data: locs, error: locErr } = await sb
    .from('locations')
    .select('id, name, external_refs, stock_source')
    .eq('org_id', orgId)
    .eq('stock_source', 'lightspeed')

  if (locErr) problems.push(`Locations: ${locErr.message}`)

  const locationByExternal = {}
  for (const l of locs ?? []) {
    const ref = l.external_refs?.lightspeed
    if (ref) locationByExternal[String(ref)] = l.id
  }

  // Brand names, so products do not all read "No brand".
  let brandNames = {}
  try {
    brandNames = await lsBrandMap(variant, creds)
  } catch (err) {
    problems.push(`Brands: ${err.message}`)
  }

  // Optional filter: only bring in these brands. Empty means everything.
  const wanted = (config.sync_brands ?? []).map((b) => String(b).trim().toLowerCase())
  const keepBrand = (name) =>
    wanted.length === 0 || wanted.includes(String(name ?? '').trim().toLowerCase())

  let products = 0
  let variants = 0
  let skipped = 0
  let invFetched = 0      // records returned by the platform
  let invMatched = 0      // records we could tie to a variant and a location
  const stockRows = []

  if (variant === 'xseries') {
    // X-Series: each product row is effectively a sellable SKU. Products that
    // belong to a family share variant_parent_id.
    let after = 0
    let guard = 0
    const productIdByExternal = {}

    while (guard < 200) {
      guard += 1
      const body = await lsFetch(
        variant, creds,
        `/api/2.0/products?page_size=500&after=${after}&deleted=false`
      )
      const list = body?.data ?? []
      if (list.length === 0) break

      // Parent products first, so variants can hang off them.
      const parents = {}
      const kept = list.filter((p) => {
        const ok = keepBrand(p.brand_name || brandNames[String(p.brand_id)])
        if (!ok) skipped += 1
        return ok
      })

      for (const p of kept) {
        const parentId = p.variant_parent_id || p.id
        if (!parents[parentId]) {
          parents[parentId] = {
            org_id: orgId,
            external_source: 'lightspeed',
            external_id: String(parentId),
            name: p.variant_parent_id ? (p.name || '').split(' / ')[0] : (p.name || 'Product'),
            external_brand: p.brand_name || brandNames[String(p.brand_id)] || null,
            image_url: p.image_thumbnail_url || null,
            status: 'active',
            last_synced_at: now,
          }
        }
      }

      const parentRows = Object.values(parents)
      let savedProducts = []
      if (parentRows.length) {
        const { data, error: pErr } = await sb
          .from('products')
          .upsert(parentRows, { onConflict: 'org_id,external_source,external_id' })
          .select('id, external_id')
        if (pErr) { problems.push(`Products: ${pErr.message}`); break }
        savedProducts = data ?? []
      }
      for (const row of savedProducts) productIdByExternal[row.external_id] = row.id
      products += savedProducts.length

      const variantRows = []
      for (const p of kept) {
        const parentId = String(p.variant_parent_id || p.id)
        const productId = productIdByExternal[parentId]
        if (!productId) continue

        variantRows.push({
          org_id: orgId,
          product_id: productId,
          external_source: 'lightspeed',
          external_id: String(p.id),
          sku: p.sku || null,
          option_name: Array.isArray(p.variant_options) && p.variant_options.length
            ? p.variant_options.map((o) => o.value).join(' / ')
            : null,
          barcode: p.barcode || null,
          unit_cost: Number(p.supply_price ?? 0),
          retail_price: Number(p.price_including_tax ?? p.price ?? 0),
          last_synced_at: now,
        })
      }

      if (variantRows.length) {
        const { error: vErr } = await sb
          .from('variants')
          .upsert(variantRows, { onConflict: 'org_id,external_source,external_id' })
        if (vErr) problems.push(`Variants: ${vErr.message}`)
        else variants += variantRows.length
      }

      const maxVersion = list.reduce(
        (m, p) => Math.max(m, Number(p.version ?? 0)), after
      )
      if (maxVersion === after || list.length < 500) break
      after = maxVersion
    }

    // Stock, if any location points at Lightspeed.
    if (Object.keys(locationByExternal).length > 0) {
      const variantIdByExternal = await loadVariantMap(sb, orgId, 'lightspeed', problems)
      let invAfter = 0
      let invGuard = 0

      while (invGuard < 200) {
        invGuard += 1
        let body
        try {
          body = await lsFetch(
            variant, creds, `/api/2.0/inventory?page_size=500&after=${invAfter}`
          )
        } catch (err) { problems.push(`Inventory: ${err.message}`); break }

        const list = body?.data ?? []
        if (list.length === 0) break

        invFetched += list.length
        for (const row of list) {
          const variantId = variantIdByExternal[String(row.product_id)]
          const locationId = locationByExternal[String(row.outlet_id)]
          if (!variantId || !locationId) continue
          invMatched += 1
          stockRows.push({
            org_id: orgId,
            variant_id: variantId,
            location_id: locationId,
            on_hand: Number(row.inventory_level ?? 0),
            updated_at: now,
          })
        }

        const maxVersion = list.reduce((m, r) => Math.max(m, Number(r.version ?? 0)), invAfter)
        if (maxVersion === invAfter || list.length < 500) break
        invAfter = maxVersion
        if (invGuard === 199) problems.push('Stopped after 100,000 stock records')
      }
    }
  } else {
    // R-Series: items carry their per shop quantities with them.
    let offset = 0
    let guard = 0

    while (guard < 400) {
      guard += 1
      let body
      try {
        body = await lsFetch(
          variant, creds,
          `/Item.json?limit=100&offset=${offset}&load_relations=${encodeURIComponent('["ItemShops"]')}`
        )
      } catch (err) { problems.push(err.message); break }

      const raw = body?.Item
      const list = Array.isArray(raw) ? raw : raw ? [raw] : []
      if (list.length === 0) break

      const keptItems = list.filter((it) => {
        const ok = keepBrand(brandNames[String(it.manufacturerID)])
        if (!ok) skipped += 1
        return ok
      })

      const productRows = keptItems.map((it) => ({
        org_id: orgId,
        external_source: 'lightspeed',
        external_id: String(it.itemID),
        name: it.description || 'Product',
        external_brand: brandNames[String(it.manufacturerID)] || null,
        status: 'active',
        last_synced_at: now,
      }))

      const { data: savedProducts, error: pErr } = await sb
        .from('products')
        .upsert(productRows, { onConflict: 'org_id,external_source,external_id' })
        .select('id, external_id')

      if (pErr) { problems.push(`Products: ${pErr.message}`); break }
      products += savedProducts?.length ?? 0

      const productIdByExternal = {}
      for (const row of savedProducts ?? []) productIdByExternal[row.external_id] = row.id

      const variantRows = keptItems.map((it) => ({
        org_id: orgId,
        product_id: productIdByExternal[String(it.itemID)],
        external_source: 'lightspeed',
        external_id: String(it.itemID),
        sku: it.customSku || it.systemSku || null,
        option_name: null,
        barcode: it.upc || it.ean || null,
        unit_cost: Number(it.defaultCost ?? 0),
        retail_price: Number(it.Prices?.ItemPrice?.[0]?.amount ?? 0),
        last_synced_at: now,
      })).filter((v) => v.product_id)

      if (variantRows.length) {
        const { data: savedVariants, error: vErr } = await sb
          .from('variants')
          .upsert(variantRows, { onConflict: 'org_id,external_source,external_id' })
          .select('id, external_id')
        if (vErr) problems.push(`Variants: ${vErr.message}`)
        else {
          variants += variantRows.length
          const variantIdByExternal = {}
          for (const row of savedVariants ?? []) variantIdByExternal[row.external_id] = row.id

          for (const it of keptItems) {
            const shops = it.ItemShops?.ItemShop
            const shopList = Array.isArray(shops) ? shops : shops ? [shops] : []
            invFetched += shopList.length
            for (const shop of shopList) {
              const variantId = variantIdByExternal[String(it.itemID)]
              const locationId = locationByExternal[String(shop.shopID)]
              if (!variantId || !locationId) continue
              invMatched += 1
              stockRows.push({
                org_id: orgId,
                variant_id: variantId,
                location_id: locationId,
                on_hand: Number(shop.qoh ?? 0),
                updated_at: now,
              })
            }
          }
        }
      }

      if (list.length < 100) break
      offset += 100
    }
  }

  let written = 0
  for (let i = 0; i < stockRows.length; i += 500) {
    const batch = stockRows.slice(i, i + 500)
    const { error: sErr } = await sb
      .from('inventory_levels')
      .upsert(batch, { onConflict: 'variant_id,location_id' })
    if (sErr) { problems.push(`Stock: ${sErr.message}`); break }
    written += batch.length
  }

  return {
    products,
    variants,
    skipped,
    stockRows: written,
    invFetched,
    invMatched,
    mappedLocations: Object.keys(locationByExternal).length,
    stockLocationMissing: Object.keys(locationByExternal).length === 0,
    error: problems.length ? problems[0] : null,
  }
}

// ---------------------------------------------------------------------------
// Suppliers and brands. Platforms keep these as two unrelated lists, so brands
// arrive without a supplier and can be matched up afterwards in the app.
// ---------------------------------------------------------------------------
async function lsBrandMap(variant, creds) {
  const map = {}
  if (variant === 'xseries') {
    let after = 0
    let guard = 0
    while (guard < 10) {
      guard += 1
      const body = await lsFetch(variant, creds, `/api/2.0/brands?page_size=500&after=${after}`)
      const list = body?.data ?? []
      if (list.length === 0) break
      for (const b of list) map[String(b.id)] = b.name
      const maxVersion = list.reduce((m, b) => Math.max(m, Number(b.version ?? 0)), after)
      if (maxVersion === after || list.length < 500) break
      after = maxVersion
    }
  } else {
    const body = await lsFetch(variant, creds, '/Manufacturer.json?limit=100')
    const raw = body?.Manufacturer
    const list = Array.isArray(raw) ? raw : raw ? [raw] : []
    for (const b of list) map[String(b.manufacturerID)] = b.name
  }
  return map
}

async function syncLightspeedSuppliersAndBrands(sb, orgId, variant, creds) {
  const problems = []
  const now = new Date().toISOString()
  let suppliers = 0
  let brands = 0

  // ---- suppliers ----
  const supplierRows = []
  try {
    if (variant === 'xseries') {
      let after = 0
      let guard = 0
      while (guard < 10) {
        guard += 1
        const body = await lsFetch(variant, creds, `/api/2.0/suppliers?page_size=500&after=${after}`)
        const list = body?.data ?? []
        if (list.length === 0) break
        for (const sup of list) {
          supplierRows.push({
            org_id: orgId,
            external_source: 'lightspeed',
            external_id: String(sup.id),
            name: sup.name || 'Supplier',
            contact_name: sup.contact?.first_name
              ? `${sup.contact.first_name} ${sup.contact.last_name ?? ''}`.trim()
              : null,
            email: sup.contact?.email || null,
            phone: sup.contact?.phone || sup.contact?.mobile || null,
            last_synced_at: now,
          })
        }
        const maxVersion = list.reduce((m, x) => Math.max(m, Number(x.version ?? 0)), after)
        if (maxVersion === after || list.length < 500) break
        after = maxVersion
      }
    } else {
      const body = await lsFetch(variant, creds, '/Vendor.json?limit=100')
      const raw = body?.Vendor
      const list = Array.isArray(raw) ? raw : raw ? [raw] : []
      for (const sup of list) {
        supplierRows.push({
          org_id: orgId,
          external_source: 'lightspeed',
          external_id: String(sup.vendorID),
          name: sup.name || 'Supplier',
          contact_name: sup.contactName || null,
          email: sup.Contact?.Emails?.ContactEmail?.address || null,
          phone: sup.Contact?.Phones?.ContactPhone?.number || null,
          last_synced_at: now,
        })
      }
    }
  } catch (err) {
    problems.push(`Suppliers: ${err.message}`)
  }

  if (supplierRows.length) {
    const { data, error } = await sb
      .from('suppliers')
      .upsert(supplierRows, { onConflict: 'org_id,external_source,external_id' })
      .select('id')
    if (error) problems.push(`Suppliers: ${error.message}`)
    else suppliers = data?.length ?? 0
  }

  // ---- brands ----
  try {
    const map = await lsBrandMap(variant, creds)
    const brandRows = Object.entries(map).map(([externalId, name]) => ({
      org_id: orgId,
      external_source: 'lightspeed',
      external_id: externalId,
      name,
      last_synced_at: now,
    }))

    if (brandRows.length) {
      const { data, error } = await sb
        .from('brands')
        .upsert(brandRows, { onConflict: 'org_id,external_source,external_id' })
        .select('id')
      if (error) problems.push(`Brands: ${error.message}`)
      else brands = data?.length ?? 0
    }
  } catch (err) {
    problems.push(`Brands: ${err.message}`)
  }

  return { suppliers, brands, error: problems.length ? problems[0] : null }
}

async function loadVariantMap(sb, orgId, source, problems) {
  const map = {}
  let from = 0
  while (from < 20000) {
    const { data, error } = await sb
      .from('variants')
      .select('id, external_id')
      .eq('org_id', orgId)
      .eq('external_source', source)
      .range(from, from + 999)
    if (error) { problems.push(`Variants lookup: ${error.message}`); break }
    for (const v of data ?? []) map[v.external_id] = v.id
    if (!data || data.length < 1000) break
    from += 1000
  }
  return map
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
        .select('variant, config')
        .match({ org_id: orgId, provider })
        .maybeSingle()

      const result = await testConnection(provider, setting?.variant, secret.credentials)

      // Merge, never replace: config also holds the sync filters.
      const backfill = { ...(setting?.config ?? {}) }
      if (provider === 'bigcommerce' && secret.credentials.store_hash) {
        backfill.store_hash = secret.credentials.store_hash
      }
      if (provider === 'shopify' && secret.credentials.shop_domain) {
        backfill.shop_domain = secret.credentials.shop_domain
      }

      await sb.from('integration_settings').upsert(
        {
          org_id: orgId,
          provider,
          config: backfill,
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

    // --- list locations from the platform ----------------------------------
    if (action === 'locations') {
      const { data: secret } = await sb
        .from('integration_secrets')
        .select('credentials')
        .match({ org_id: orgId, provider })
        .maybeSingle()

      if (!secret) return res.status(400).json({ error: 'Not connected yet.' })

      const { data: setting } = await sb
        .from('integration_settings')
        .select('variant')
        .match({ org_id: orgId, provider })
        .maybeSingle()

      try {
        const result = await fetchRemoteLocations(provider, setting?.variant, secret.credentials)
        if (result?.unsupported) {
          return res.status(200).json({ ok: true, unsupported: true, locations: [] })
        }
        return res.status(200).json({ ok: true, locations: result })
      } catch (err) {
        return res.status(200).json({ ok: false, error: err.message, locations: [] })
      }
    }

    // --- sync orders from the platform -------------------------------------
    if (
      action === 'sync_orders' || action === 'order_lines' ||
      action === 'check_refunds' || action === 'sync_products' ||
      action === 'sync_suppliers'
    ) {
      const { data: secret } = await sb
        .from('integration_secrets')
        .select('credentials')
        .match({ org_id: orgId, provider })
        .maybeSingle()

      if (!secret) return res.status(400).json({ error: 'Not connected yet.' })
      if (
        provider !== 'bigcommerce' &&
        action !== 'sync_products' && action !== 'sync_suppliers'
      ) {
        return res.status(400).json({ error: 'Order sync currently supports BigCommerce.' })
      }

      try {
        if (action === 'sync_suppliers') {
          if (provider !== 'lightspeed') {
            return res.status(400).json({ error: 'Supplier import supports Lightspeed.' })
          }
          const { data: setting } = await sb
            .from('integration_settings')
            .select('variant')
            .match({ org_id: orgId, provider })
            .maybeSingle()
          const out = await syncLightspeedSuppliersAndBrands(
            sb, orgId, setting?.variant ?? 'xseries', secret.credentials
          )
          return res.status(200).json({ ok: !out.error, ...out })
        }
        if (action === 'sync_products') {
          const { data: setting } = await sb
            .from('integration_settings')
            .select('variant, config')
            .match({ org_id: orgId, provider })
            .maybeSingle()

          if (provider === 'lightspeed') {
            const out = await syncLightspeedProducts(
              sb, orgId, setting?.variant ?? 'xseries', secret.credentials, setting?.config ?? {}
            )
            return res.status(200).json({ ok: !out.error, ...out })
          }
          const out = await syncBigCommerceProducts(
            sb, orgId, secret.credentials, setting?.config ?? {}
          )
          return res.status(200).json({ ok: !out.error, ...out })
        }
        if (action === 'check_refunds') {
          const out = await checkRefundsForOpenReturns(sb, orgId, secret.credentials)
          return res.status(200).json({ ok: !out.error, ...out })
        }
        if (action === 'sync_orders') {
          const out = await syncBigCommerceOrders(sb, orgId, secret.credentials)
          return res.status(200).json({ ok: true, ...out })
        }
        const lines = await loadBigCommerceOrderLines(
          sb, orgId, secret.credentials, req.body.order_id
        )
        return res.status(200).json({ ok: true, lines })
      } catch (err) {
        return res.status(200).json({ ok: false, error: err.message })
      }
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

      // The store hash is not a credential on its own, and the app needs it to
      // build links into the platform's admin.
      const { data: existing } = await sb
        .from('integration_settings')
        .select('config')
        .match({ org_id: orgId, provider })
        .maybeSingle()

      const publicConfig = { ...(existing?.config ?? {}), ...(config ?? {}) }
      if (provider === 'bigcommerce' && credentials.store_hash) {
        publicConfig.store_hash = credentials.store_hash
      }
      if (provider === 'shopify' && credentials.shop_domain) {
        publicConfig.shop_domain = credentials.shop_domain
      }

      await sb.from('integration_settings').upsert(
        {
          org_id: orgId,
          provider,
          variant: variant ?? null,
          config: publicConfig,
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
