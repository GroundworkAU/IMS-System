-- ============================================================================
-- IMS System — 0016: where each location's stock figures come from
--
-- Stock for a location may be reported by a different platform to the one it
-- sells through. An online store's stock often originates in the point of sale
-- and is only mirrored to the web platform, so the source is a per location
-- choice rather than something to assume.
--
-- null = not synced, managed by hand.
-- ============================================================================

alter table locations
  add column if not exists stock_source text
    check (stock_source in ('bigcommerce','shopify','lightspeed'));

-- Anything already mapped to BigCommerce keeps working as it does today.
update locations
   set stock_source = 'bigcommerce'
 where stock_source is null
   and external_refs ? 'bigcommerce';
