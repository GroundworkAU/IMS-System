import * as XLSX from 'xlsx'

// Read a spreadsheet into plain rows of cells, keeping blank cells so column
// letters line up with what the person sees in Excel.
export async function readWorkbook(file) {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { cellDates: true })

  return wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1, defval: null, blankrows: true, raw: true,
    })
    return { name, rows }
  })
}

export const colLetter = (i) => XLSX.utils.encode_col(i)

// Header cells often carry several names at once, e.g. "S sr.\nS\n171CM".
// Take something readable as a starting point; the person can correct it.
export function cleanHeader(value) {
  if (value == null) return ''
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text
}

export function guessSize(value) {
  if (value == null) return ''
  const parts = String(value).split(/[\n\r]+/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return ''
  // Prefer a part that looks like a size rather than a measurement.
  const notCm = parts.filter((p) => !/^\d+\s*cm$/i.test(p))
  return (notCm[0] ?? parts[0]).replace(/\.$/, '').trim()
}

export const isNumeric = (v) =>
  v !== null && v !== '' && !isNaN(Number(String(v).replace(/,/g, '')))

export const toNumber = (v) =>
  isNumeric(v) ? Number(String(v).replace(/,/g, '')) : 0

// Barcodes come through as numbers surprisingly often, which loses leading
// zeros and can arrive in exponent form. Put them back to a plain string.
export function normaliseBarcode(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    // Avoid 9.32e+12 style output for long codes.
    return BigInt(Math.round(value)).toString()
  }
  const text = String(value).trim()
  if (!text) return null
  // Excel sometimes hands back "9327345000123.0"
  return text.replace(/\.0+$/, '')
}
