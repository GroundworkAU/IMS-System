// Vercel serverless function. Establishes the /api pattern; server-only secrets
// (e.g. SUPABASE_SERVICE_ROLE_KEY) will be read from process.env here, never in
// the client bundle.
export default function handler(req, res) {
  res.status(200).json({ ok: true, service: 'ims-system', time: new Date().toISOString() })
}
