-- ============================================================================
-- IMS System — 0022: fulfilment can be a work in progress
--
-- Working out what you can send takes time when a request runs to dozens of
-- lines. A 'building' order is a fulfilment someone has started but not yet
-- committed: it holds their quantities without touching the request's totals.
-- Confirming moves it to 'draft', which means ready to send to the warehouse.
-- ============================================================================

alter table restock_orders drop constraint if exists restock_orders_status_check;

alter table restock_orders
  add constraint restock_orders_status_check
  check (status in ('building','draft','sent','received','discrepancy','closed','cancelled'));
