-- ============================================================================
-- IMS System — 0023: a request can be closed without being fully covered
--
-- 'fulfilled' means everything asked for was sent. 'closed' means no more is
-- coming, whatever the reason ~ the rest is out of stock, no longer needed, or
-- being handled another way. Keeping them apart matters when looking back at
-- how well requests were actually met.
-- ============================================================================

alter table restock_requests drop constraint if exists restock_requests_status_check;

alter table restock_requests
  add constraint restock_requests_status_check
  check (status in ('draft','open','partly_fulfilled','fulfilled','closed','cancelled'));

alter table restock_requests
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references profiles on delete set null,
  add column if not exists closed_reason text;
