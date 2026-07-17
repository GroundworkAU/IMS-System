-- ============================================================================
-- IMS System — 0002: seed suppliers + brand->supplier mappings
-- Source: PAFC brand/supplier table. Idempotent (safe to re-run).
-- ============================================================================

-- Supplier display names should be unique (enables clean lookups + re-runs).
alter table suppliers add constraint suppliers_name_key unique (name);

insert into suppliers (name) values
  ('Ashtabula'),
  ('KOOKABURRA SPORT PTY LTD'),
  ('Korimco Toys'),
  ('Licensing Essentials'),
  ('MACRON TECHNICAL SPORTSWEAR'),
  ('NAR'),
  ('New Era'),
  ('Playcorp Pty Ltd'),
  ('Russell Athletic'),
  ('Sporting Souveniers'),
  ('Stubby Club'),
  ('Trofe'),
  ('David Golf')
on conflict (name) do nothing;

insert into brands (name, supplier_id)
select b.brand, s.id
from (values
  ('ASHTABULA',                    'Ashtabula'),
  ('Kookaburra',                   'KOOKABURRA SPORT PTY LTD'),
  ('Korimco Toys',                 'Korimco Toys'),
  ('Licensing Essentials',         'Licensing Essentials'),
  ('MACRON TECHNICAL SPORTSWEAR',  'MACRON TECHNICAL SPORTSWEAR'),
  ('NAR',                          'NAR'),
  ('New Era',                      'New Era'),
  ('Playcorp',                     'Playcorp Pty Ltd'),
  ('Sherrin',                      'Russell Athletic'),
  ('Sporting Souveniers',          'Sporting Souveniers'),
  ('Stubby Club',                  'Stubby Club'),
  ('Trofe',                        'Trofe'),
  ('Callaway',                     'David Golf'),
  ('Mitchell & Ness',              'NAR')
) as b(brand, supplier_name)
join suppliers s on s.name = b.supplier_name
on conflict (name) do nothing;
