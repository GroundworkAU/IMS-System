-- ============================================================================
-- IMS System — 0020: one catalogue source
--
-- Products are keyed per platform, so anything sold on two platforms arrives
-- twice. Rather than guessing at matches, a business nominates which platform
-- owns the catalogue and only that one brings products in. Other platforms are
-- still used for what they are best at ~ orders, customers, refunds.
-- ============================================================================

alter table organisations
  add column if not exists catalogue_source text
    check (catalogue_source in ('bigcommerce','shopify','lightspeed'));

-- Sensible default: Lightspeed where connected, otherwise whatever is.
update organisations o
   set catalogue_source = coalesce(
     (select provider from integration_settings
       where org_id = o.id and provider = 'lightspeed' and status = 'connected' limit 1),
     (select provider from integration_settings
       where org_id = o.id and status = 'connected'
       order by provider limit 1)
   )
 where catalogue_source is null;
