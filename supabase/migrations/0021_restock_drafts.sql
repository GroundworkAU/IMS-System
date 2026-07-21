-- ============================================================================
-- IMS System — 0021: restock requests can be saved as a draft
--
-- Building a request can take a while when working through the catalogue, so a
-- half finished one should survive being interrupted. Drafts are only visible
-- to the person building them until raised.
-- ============================================================================

alter table restock_requests drop constraint if exists restock_requests_status_check;

alter table restock_requests
  add constraint restock_requests_status_check
  check (status in ('draft','open','partly_fulfilled','fulfilled','cancelled'));
