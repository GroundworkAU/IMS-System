// Sizes come back from the platform in whatever order it stores them, which
// looks random on screen. Sort them the way a person would expect.
const ORDER = [
  'xxs', 'xs', 's', 'm', 'l', 'xl', '2xl', 'xxl', '3xl', 'xxxl',
  '4xl', '5xl', '6xl', '7xl', '8xl',
]

function rank(label) {
  if (!label) return 9999
  const key = String(label).trim().toLowerCase()
  const i = ORDER.indexOf(key)
  if (i !== -1) return i

  // Youth and numeric sizes (2, 4, 6 ... or 8Y) sort numerically after letters.
  const num = key.match(/^(\d+)\s*(y|yr|yrs)?$/)
  if (num) return 100 + Number(num[1])

  return 500
}

export function sortVariants(variants) {
  return [...(variants ?? [])].sort((a, b) => {
    const ra = rank(a.option_name)
    const rb = rank(b.option_name)
    if (ra !== rb) return ra - rb
    return String(a.option_name || '').localeCompare(String(b.option_name || ''))
  })
}
