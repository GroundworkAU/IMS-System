-- ============================================================================
-- IMS System — 0009: returns are either open or refunded
--
-- A return starts 'open' the moment it is logged. It moves to 'refunded' when
-- someone refunds it, either manually or because we spotted the refund on the
-- sales platform during a sync.
-- ============================================================================

alter table returns drop constraint if exists returns_status_check;

update returns
   set status = case
     when status in ('refunded') then 'refunded'
     when status in ('rejected') then 'cancelled'
     else 'open'
   end
 where status not in ('open','refunded','cancelled');

alter table returns alter column status set default 'open';

alter table returns
  add constraint returns_status_check
  check (status in ('open','refunded','cancelled'));

alter table returns
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_source text
    check (refund_source in ('manual','platform'));
