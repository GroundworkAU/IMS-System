-- ============================================================================
-- IMS System — 0006: simplify location types to physical / online store
-- ============================================================================

alter table locations drop constraint if exists locations_type_check;

-- Map existing values across. Anything previously a warehouse or 'other' is
-- treated as an online store location (stock held for web orders); stores and
-- pop ups become physical.
update locations
   set type = case
     when type in ('store','popup') then 'physical'
     when type in ('warehouse','other') then 'online'
     else 'physical'
   end
 where type not in ('physical','online');

alter table locations
  alter column type set default 'physical';

alter table locations
  add constraint locations_type_check
  check (type in ('physical','online'));
