-- Run as postgres after ingestion.sql. All test data is rolled back.
begin;
set local role anon;
do $$
declare
  payload jsonb := jsonb_build_object(
    'product_id', 'ozone_ingestion-verification', 'site', 'ozone',
    'url', 'https://www.ozone.bg/product/ingestion-verification/',
    'price', 80, 'observed_date', current_date::text,
    'client_observed_at', now()::text
  );
begin
  begin
    perform 1 from public.price_history limit 1;
    raise exception 'FAIL: anonymous table read succeeded';
  exception when insufficient_privilege then null;
  end;
  if has_table_privilege('anon', 'public.price_history', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.price_history', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'FAIL: direct table grant remains';
  end if;
  perform public.ingest_price_observation(repeat('a', 64), payload);
  -- An older request must not overwrite the newer same-day observation.
  perform public.ingest_price_observation(repeat('a', 64), payload ||
    jsonb_build_object('price', 100, 'client_observed_at', (now()-interval '1 minute')::text));
  perform public.ingest_price_observation(repeat('b', 64), payload || jsonb_build_object('price', 50));
  begin
    perform public.ingest_price_observation(repeat('a', 64), payload || jsonb_build_object('url', 'https://evil.example/'));
    raise exception 'FAIL: unsupported host accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.ingest_price_observation('invalid', payload);
    raise exception 'FAIL: invalid credential accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
reset role;
do $$
declare
  stored_price numeric;
begin
  select price into stored_price from public.price_history
    where device_id = substring(encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'),1,32)::uuid
      and product_id = 'ozone_ingestion-verification' and observed_date = current_date;
  if stored_price is distinct from 80 then raise exception 'FAIL: ordering or ownership failed'; end if;
  select price into stored_price from public.price_history
    where device_id = substring(encode(sha256(convert_to(repeat('b',64),'UTF8')),'hex'),1,32)::uuid
      and product_id = 'ozone_ingestion-verification' and observed_date = current_date;
  if stored_price is distinct from 50 then raise exception 'FAIL: installation isolation failed'; end if;
end;
$$;
rollback;
