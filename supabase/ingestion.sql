-- Apply in the project's SQL editor as postgres. This does not delete history.
-- The client sends a random 256-bit installation secret over HTTPS. Deriving
-- the row identity here prevents callers from choosing another install's ID.
begin;

alter table public.price_history enable row level security;
revoke all on public.price_history from public, anon, authenticated;
drop policy if exists "anon can insert" on public.price_history;
drop policy if exists "anon can update" on public.price_history;
drop policy if exists "anon can select" on public.price_history;
alter table public.price_history add column if not exists client_observed_at timestamptz;

create or replace function public.ingest_price_observation(installation_secret text, observation jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  device uuid;
  host text;
  store_host text;
  price_value numeric;
  old_price numeric;
  observed_date_value date;
  observed_time timestamptz;
begin
  if installation_secret is null or installation_secret !~ '^[0-9a-f]{64}$'
    or observation is null or jsonb_typeof(observation) <> 'object'
    or octet_length(observation::text) > 16384 then
    raise exception 'Invalid observation' using errcode = '22023';
  end if;
  device := substring(encode(sha256(convert_to(installation_secret, 'UTF8')), 'hex'), 1, 32)::uuid;
  store_host := case observation->>'site'
    when 'emag' then 'emag.bg' when 'ozone' then 'ozone.bg'
    when 'notino' then 'notino.bg' when 'technopolis' then 'technopolis.bg'
    when 'technomarket' then 'technomarket.bg' when 'zora' then 'zora.bg'
    when 'ardes' then 'ardes.bg' when 'plesio' then 'plesio.bg'
    when 'aboutyou' then 'aboutyou.bg' when 'answear' then 'answear.bg'
    when 'decathlon' then 'decathlon.bg' when 'dm' then 'dm-drogeriemarkt.bg'
    when 'fashiondays' then 'fashiondays.bg' when 'lilly' then 'lillydrogerie.bg'
    when 'bricolage' then 'mr-bricolage.bg' when 'obuvki' then 'obuvki.bg'
    when 'praktiker' then 'praktiker.bg' when 'sopharmacy' then 'sopharmacy.bg'
    when 'sportdepot' then 'sportdepot.bg' when 'ebag' then 'ebag.bg' end;
  host := substring(observation->>'url' from '^https://([^/?#]+)(?:/|$)');
  if store_host is null or host is null or host not in (store_host, 'www.' || store_host)
    or coalesce(length(observation->>'product_id'), 0) not between 3 and 1000
    or left(observation->>'product_id', length(observation->>'site') + 1) <> (observation->>'site') || '_'
    or coalesce(observation->>'observed_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(observation->>'price', '') !~ '^\d+(\.\d{1,2})?$' then
    raise exception 'Invalid product' using errcode = '22023';
  end if;
  price_value := (observation->>'price')::numeric;
  old_price := (observation->>'original_price')::numeric;
  observed_date_value := (observation->>'observed_date')::date;
  observed_time := (observation->>'client_observed_at')::timestamptz;
  if price_value not between 0.01 and 1000000
    or (old_price is not null and (old_price::text in ('NaN', 'Infinity', '-Infinity') or old_price not between 0.01 and 1000000))
    or observed_time is null or observed_time > now() + interval '5 minutes'
    or observed_time < timestamptz '2000-01-01'
    or observed_date_value < date '2000-01-01' or observed_date_value > current_date + 1 then
    raise exception 'Invalid price or observation date' using errcode = '22023';
  end if;

  insert into public.price_history (
    device_id, product_id, site, url, title, thumbnail, ean, price,
    original_price, discount, observed_date, ext_version, user_agent, client_observed_at
  ) values (
    device, observation->>'product_id', observation->>'site', observation->>'url',
    left(observation->>'title', 1000), left(observation->>'thumbnail', 4000),
    case when observation->>'ean' ~ '^(\d{8}|\d{12}|\d{13}|\d{14})$' then observation->>'ean' end,
    price_value, old_price,
    case when old_price > price_value then round((old_price-price_value)/old_price*100)::int end,
    observed_date_value, left(observation->>'ext_version', 32), left(observation->>'user_agent', 1000), observed_time
  )
  on conflict (device_id, product_id, observed_date) do update set
    price = excluded.price, original_price = excluded.original_price, discount = excluded.discount,
    url = excluded.url, title = excluded.title, thumbnail = excluded.thumbnail, ean = excluded.ean,
    ext_version = excluded.ext_version, user_agent = excluded.user_agent,
    observed_at = now(), client_observed_at = excluded.client_observed_at
  where public.price_history.client_observed_at is null
    or excluded.client_observed_at > public.price_history.client_observed_at;
end;
$$;

revoke all on function public.ingest_price_observation(text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_price_observation(text, jsonb) to anon;
notify pgrst, 'reload schema';
commit;
