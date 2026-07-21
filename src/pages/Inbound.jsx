import Placeholder from '../components/Placeholder'
export default function Inbound() {
  return (
    <Placeholder
      eyebrow="Inventory"
      title="Inbound Shipments"
      desc="Track landings against each order ~ a single order can arrive in multiple shipments. Direct from a supplier (with carrier tracking and ETA) or transferred from another location (sent / received, no tracking)."
      phase="Phase 4"
      note="Live carrier tracking is wired once we confirm which carriers your suppliers use."
    />
  )
}
