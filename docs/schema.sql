-- starter-fundraise ledger. Run once in the Supabase SQL editor.
--
-- RLS is on for every table with no policies, so the anon and authenticated
-- roles can read and write nothing. The Next.js server talks to this schema
-- with the service role key only. The three functions at the bottom are the
-- only way money state changes, and `mark_position_paid` is the only way a
-- position becomes sold.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- campaigns
create table if not exists campaigns (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  athlete           text not null check (char_length(athlete) between 1 and 80),
  sport             text not null check (char_length(sport) between 1 and 40),
  event             text not null default '' check (char_length(event) <= 120),
  city              text not null default '' check (char_length(city) <= 80),
  story             text not null default '' check (char_length(story) <= 600),
  stripe_account_id text,
  payout_address    text check (payout_address is null or payout_address ~ '^0x[0-9a-fA-F]{40}$'),
  created_at        timestamptz not null default now()
);

-- The athlete's email lives apart from the public row so a future read
-- policy on campaigns cannot leak it by accident.
create table if not exists campaign_private (
  campaign_id uuid primary key references campaigns(id) on delete cascade,
  email       text not null check (char_length(email) <= 254)
);

-- ---------------------------------------------------------------- positions
-- price_cents is an integer. Never a numeric, never a float, never text:
-- every comparison downstream is on whole cents.
create table if not exists positions (
  id                   uuid primary key default gen_random_uuid(),
  campaign_id          uuid not null references campaigns(id) on delete cascade,
  n                    integer not null check (n >= 1),
  item                 text not null default '' check (char_length(item) <= 40),
  name                 text not null check (char_length(name) between 1 and 40),
  size                 text not null default '' check (char_length(size) <= 40),
  price_cents          integer not null check (price_cents between 100 and 5000000),
  status               text not null default 'open' check (status in ('open','held','sold')),
  hold_reservation_id  uuid,
  hold_expires_at      timestamptz,
  sold_reservation_id  uuid,
  unique (campaign_id, n),
  -- a sold position always names the reservation that paid for it. A row
  -- that is sold with nothing behind it (the "admin marked everything sold"
  -- lesson) cannot exist.
  constraint sold_has_reservation check (status <> 'sold' or sold_reservation_id is not null),
  constraint held_has_expiry      check (status <> 'held' or (hold_reservation_id is not null and hold_expires_at is not null))
);
create index if not exists positions_campaign on positions(campaign_id, n);

-- ------------------------------------------------------------- reservations
create table if not exists reservations (
  id            uuid primary key default gen_random_uuid(),
  reference     text not null unique check (reference ~ '^FR-[0-9A-HJKMNP-TV-Z]{10}$'),
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  position_id   uuid not null references positions(id) on delete cascade,
  provider      text not null check (provider in ('stripe','usdc','demo','manual')),
  payer         text not null default '',
  brand         text not null default '' check (char_length(brand) <= 80),
  amount_cents  integer not null check (amount_cents > 0),
  fee_cents     integer not null check (fee_cents >= 0),
  status        text not null default 'held' check (status in ('held','paid','expired','cancelled')),
  -- Stripe session id, USDC tx hash or an admin note. Unique so the same
  -- payment delivered twice can only ever count once.
  provider_ref  text unique,
  raw           jsonb,
  expires_at    timestamptz not null,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  constraint paid_has_ref check (status <> 'paid' or (provider_ref is not null and paid_at is not null))
);
create index if not exists reservations_position on reservations(position_id);

alter table positions
  add constraint positions_sold_fk foreign key (sold_reservation_id) references reservations(id);

-- Money that arrived with no reservation to attach to. Surfaced, never dropped.
create table if not exists unmatched_payments (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  provider_ref text not null unique,
  payer        text not null default '',
  amount_cents integer not null default 0,
  reason       text not null,
  raw          jsonb,
  created_at   timestamptz not null default now()
);

alter table campaigns          enable row level security;
alter table campaign_private   enable row level security;
alter table positions          enable row level security;
alter table reservations       enable row level security;
alter table unmatched_payments enable row level security;

-- ---------------------------------------------------------------- functions

-- Create a campaign and its positions in one transaction. Input is the
-- validated shape from lib/campaign.ts; prices arrive as cents.
create or replace function create_campaign(p jsonb)
returns campaigns
language plpgsql
as $$
declare
  c campaigns;
  base text;
  s text;
  i int := 0;
  pos jsonb;
  n int := 0;
begin
  base := coalesce(nullif(p->>'slug', ''), 'campaign');
  s := base;
  while exists (select 1 from campaigns where slug = s) loop
    i := i + 1;
    s := base || '-' || (i + 1);
  end loop;

  insert into campaigns (slug, athlete, sport, event, city, story)
  values (s, p->>'athlete', p->>'sport', coalesce(p->>'event',''), coalesce(p->>'city',''), coalesce(p->>'story',''))
  returning * into c;

  insert into campaign_private (campaign_id, email) values (c.id, lower(p->>'email'));

  for pos in select * from jsonb_array_elements(p->'positions') loop
    n := n + 1;
    insert into positions (campaign_id, n, item, name, size, price_cents)
    values (c.id, n, coalesce(pos->>'item',''), pos->>'name', coalesce(pos->>'size',''), (pos->>'priceCents')::int);
  end loop;

  return c;
end;
$$;

-- Put expired holds back on sale. Cheap, called before reads and reserves.
create or replace function release_expired_holds()
returns void
language sql
as $$
  with lapsed as (
    update positions
       set status = 'open', hold_reservation_id = null, hold_expires_at = null
     where status = 'held' and hold_expires_at <= now()
     returning hold_reservation_id as rid
  )
  update reservations r set status = 'expired'
   from lapsed where r.id = lapsed.rid and r.status = 'held';
$$;

-- Reserve a position before checkout. Locks the row, refuses a position
-- that is sold or under a live hold, and returns the reservation.
create or replace function reserve_position(
  p_position uuid, p_provider text, p_payer text, p_brand text,
  p_reference text, p_fee_cents int, p_hold_seconds int
)
returns reservations
language plpgsql
as $$
declare
  pos positions;
  r reservations;
begin
  perform release_expired_holds();

  select * into pos from positions where id = p_position for update;
  if not found then raise exception 'not_found'; end if;
  if pos.status = 'sold' then raise exception 'sold'; end if;
  if pos.status = 'held' then raise exception 'held'; end if;

  insert into reservations (reference, campaign_id, position_id, provider, payer, brand, amount_cents, fee_cents, expires_at)
  values (p_reference, pos.campaign_id, pos.id, p_provider, p_payer, left(coalesce(p_brand,''), 80),
          pos.price_cents, p_fee_cents, now() + make_interval(secs => p_hold_seconds))
  returning * into r;

  update positions
     set status = 'held', hold_reservation_id = r.id, hold_expires_at = r.expires_at
   where id = pos.id;

  return r;
end;
$$;

-- The one way a position becomes sold. Idempotent on provider_ref: the
-- same Stripe event or the same tx hash delivered twice returns the first
-- result and changes nothing. Any other repeat raises.
create or replace function mark_position_paid(
  p_reference text, p_provider text, p_provider_ref text, p_amount_cents int, p_raw jsonb
)
returns reservations
language plpgsql
as $$
declare
  r reservations;
  pos positions;
  other reservations;
begin
  select * into r from reservations where reference = p_reference for update;
  if not found then raise exception 'not_found'; end if;

  if r.status = 'paid' then
    if r.provider_ref = p_provider_ref then return r; end if;
    raise exception 'already_paid_elsewhere';
  end if;

  select * into other from reservations where provider_ref = p_provider_ref and id <> r.id;
  if found then raise exception 'already_paid_elsewhere'; end if;

  if p_amount_cents <> r.amount_cents then raise exception 'amount_mismatch'; end if;

  select * into pos from positions where id = r.position_id for update;
  -- the hold may have lapsed while the buyer sat on the checkout page.
  -- Money arrived, so the position is theirs unless someone else paid first.
  if pos.status = 'sold' and pos.sold_reservation_id <> r.id then raise exception 'sold'; end if;

  update reservations
     set status = 'paid', provider = p_provider, provider_ref = p_provider_ref, paid_at = now(), raw = p_raw
   where id = r.id
   returning * into r;

  update positions
     set status = 'sold', sold_reservation_id = r.id, hold_reservation_id = null, hold_expires_at = null
   where id = pos.id;

  return r;
end;
$$;

-- Let go of a hold early (the buyer closed Stripe, or the session expired).
create or replace function release_hold(p_reference text)
returns void
language plpgsql
as $$
declare
  r reservations;
begin
  select * into r from reservations where reference = p_reference for update;
  if not found or r.status <> 'held' then return; end if;
  update reservations set status = 'cancelled' where id = r.id;
  update positions
     set status = 'open', hold_reservation_id = null, hold_expires_at = null
   where id = r.position_id and status = 'held' and hold_reservation_id = r.id;
end;
$$;

-- Nothing here is callable by anon or authenticated. Service role only.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
