import Placeholder from '../components/Placeholder'
export default function Admin() {
  return (
    <Placeholder
      eyebrow="Admin"
      title="Users"
      desc="Add and assign users. Internal PAFC staff get full access; supplier users see only their own brand; warehouse users get goods inwards/outwards and returns."
      phase="Phase 1 — needs service-role key"
      note="User invites use a serverless /api function with the Supabase service-role key (never exposed to the browser)."
    />
  )
}
