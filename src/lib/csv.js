// Turn rows into a CSV and hand it to the browser as a download.
function escape(value) {
  if (value == null) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(columns, rows) {
  const head = columns.map((c) => escape(c.label)).join(',')
  const body = rows.map((row) => columns.map((c) => escape(c.value(row))).join(','))
  return [head, ...body].join('\n')
}

export function downloadCsv(filename, columns, rows) {
  const csv = toCsv(columns, rows)
  // The BOM keeps Excel happy with anything non ascii.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export const csvDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')
