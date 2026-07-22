-- ============================================================================
-- IMS System — 0024: importing supplier orders and pushing them to the POS
--
-- Supplier confirmations arrive as a size matrix (sizes across columns). We
-- unpivot them into one line per size. Each line records what it became in
-- Lightspeed once pushed, so a push can be repeated safely.
-- ============================================================================

alter table purchase_orders
  add column if not exists source_file_name text,
  add column if not exists pushed_at timestamptz,
  add column if not exists pushed_by uuid references profiles on delete set null;

alter table purchase_order_lines
  add column if not exists colour text,
  add column if not exists retail_price numeric(12,2),
  add column if not exists external_product_id text,   -- id in the POS once created
  add column if not exists external_parent_id text,
  add column if not exists pushed_at timestamptz,
  add column if not exists push_error text;

-- Templates remember how to read a supplier's file, matched on header text so
-- reordered columns still work.
alter table import_templates
  add column if not exists size_aliases jsonb not null default '{}'::jsonb,
  add column if not exists last_used_at timestamptz;
