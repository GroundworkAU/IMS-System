import Placeholder from '../components/Placeholder'
export default function Settings() {
  return (
    <Placeholder
      eyebrow="Admin"
      title="Integrations"
      desc="Connect Lightspeed and BigCommerce by pasting API credentials here. Secrets are stored in Supabase Vault, never in a plain database column or the frontend bundle."
      phase="Phase 3 / 5"
    />
  )
}
