// Platforms a business might run their inventory or online store on.
// Used to decide which platform specific fields to show elsewhere in the app.
export const PLATFORMS = [
  {
    value: 'lightspeed',
    label: 'Lightspeed',
    kind: 'Point of sale',
    refLabel: 'Lightspeed outlet reference',
    refHint: 'The outlet id this location matches in Lightspeed.',
  },
  {
    value: 'shopify',
    label: 'Shopify',
    kind: 'Online store',
    refLabel: 'Shopify location ID',
    refHint: 'The location id this matches in your Shopify admin.',
  },
  {
    value: 'bigcommerce',
    label: 'BigCommerce',
    kind: 'Online store',
    refLabel: 'BigCommerce location ID',
    refHint: 'The location id this matches in BigCommerce.',
  },
  {
    value: 'other',
    label: 'Something else',
    kind: 'Other system',
    refLabel: 'External reference',
    refHint: 'How this location is identified in your other system.',
  },
]

export const platformInfo = (value) =>
  PLATFORMS.find((p) => p.value === value) ?? {
    value, label: value, refLabel: 'External reference', refHint: '',
  }
