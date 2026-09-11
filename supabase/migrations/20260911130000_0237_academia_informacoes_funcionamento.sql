-- 0237 — informações operacionais e funcionamento semanal da academia.
-- O banco relacional é a fonte oficial; zero linha no dia significa fechado.

create table if not exists public.academia_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  address text check(address is null or length(address) <= 500),
  phone text check(phone is null or length(phone) <= 32),
  whatsapp text check(whatsapp is null or length(whatsapp) <= 32),
  email text check(
    email is null or (
      length(email) <= 320
      and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  ),
  public_rules text check(public_rules is null or length(public_rules) <= 5000),
  revision integer not null check(revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.academia_profiles enable row level security;
revoke all on public.academia_profiles from public, anon, authenticated;
grant select on public.academia_profiles to authenticated;
grant all on public.academia_profiles to service_role;
drop policy if exists academia_profiles_select on public.academia_profiles;
create policy academia_profiles_select on public.academia_profiles
  for select to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    and exists (
      select 1
        from public.organizations o
       where o.id = organization_id
         and o.settings->'modules'->'academia' = 'true'::jsonb
    )
  );
drop trigger if exists academia_profiles_updated_at on public.academia_profiles;
create trigger academia_profiles_updated_at
  before update on public.academia_profiles
  for each row execute function public.fn_set_updated_at();

create table if not exists public.academia_opening_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.academia_profiles(organization_id) on delete cascade,
  weekday integer not null check(weekday between 1 and 7),
  opens_at time(0) without time zone not null check(extract(second from opens_at) = 0),
  closes_at time(0) without time zone not null check(extract(second from closes_at) = 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, weekday),
  check(opens_at < closes_at)
);

alter table public.academia_opening_hours enable row level security;
revoke all on public.academia_opening_hours from public, anon, authenticated;
grant select on public.academia_opening_hours to authenticated;
grant all on public.academia_opening_hours to service_role;
drop policy if exists academia_opening_hours_select on public.academia_opening_hours;
create policy academia_opening_hours_select on public.academia_opening_hours
  for select to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    and exists (
      select 1
        from public.organizations o
       where o.id = organization_id
         and o.settings->'modules'->'academia' = 'true'::jsonb
    )
  );
drop trigger if exists academia_opening_hours_updated_at on public.academia_opening_hours;
create trigger academia_opening_hours_updated_at
  before update on public.academia_opening_hours
  for each row execute function public.fn_set_updated_at();

create or replace function public.fn_salvar_academia_info(
  p_org uuid,
  p_expected_revision integer,
  p_address text,
  p_phone text,
  p_whatsapp text,
  p_email text,
  p_public_rules text,
  p_timezone text,
  p_periods jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_current_revision integer := 0;
  v_new_revision integer;
  v_period jsonb;
  v_weekday integer;
  v_seen_weekdays integer[] := '{}'::integer[];
begin
  select settings
    into v_settings
    from public.organizations
   where id = p_org
   for update;

  if not found
     or auth.uid() is null
     or not public.fn_role_at_least(p_org, 'manager')
     or not public.fn_support_write_allowed(p_org)
     or not public.fn_session_mfa_proven()
     or coalesce(v_settings->'modules'->>'academia', 'false') <> 'true'
  then
    raise exception 'academia_info_forbidden' using errcode = '42501';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'academia_info_revision_invalid' using errcode = '22023';
  end if;

  if p_timezone is null
     or length(p_timezone) > 64
     or not exists(select 1 from pg_timezone_names where name = p_timezone)
  then
    raise exception 'academia_info_timezone_invalid' using errcode = '22023';
  end if;

  if p_periods is null
     or jsonb_typeof(p_periods) is distinct from 'array'
     or jsonb_array_length(p_periods) > 7
  then
    raise exception 'academia_info_periods_invalid' using errcode = '22023';
  end if;

  for v_period in select value from jsonb_array_elements(p_periods)
  loop
    if jsonb_typeof(v_period) is distinct from 'object'
       or not (v_period ?& array['weekday', 'opens_at', 'closes_at'])
       or exists (
         select 1
           from jsonb_object_keys(v_period) as keys(key)
          where key not in ('weekday', 'opens_at', 'closes_at')
       )
       or jsonb_typeof(v_period->'weekday') is distinct from 'number'
       or jsonb_typeof(v_period->'opens_at') is distinct from 'string'
       or jsonb_typeof(v_period->'closes_at') is distinct from 'string'
       or v_period->>'weekday' !~ '^[1-7]$'
       or v_period->>'opens_at' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or v_period->>'closes_at' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or v_period->>'opens_at' >= v_period->>'closes_at'
    then
      raise exception 'academia_info_period_invalid' using errcode = '22023';
    end if;

    v_weekday := (v_period->>'weekday')::integer;
    if v_weekday = any(v_seen_weekdays) then
      raise exception 'academia_info_duplicate_weekday' using errcode = '22023';
    end if;
    v_seen_weekdays := array_append(v_seen_weekdays, v_weekday);
  end loop;

  if (p_address is not null and length(btrim(p_address)) > 500)
     or (p_phone is not null and length(btrim(p_phone)) > 32)
     or (p_whatsapp is not null and length(btrim(p_whatsapp)) > 32)
     or (p_email is not null and length(btrim(p_email)) > 320)
     or (p_public_rules is not null and length(btrim(p_public_rules)) > 5000)
     or (
       nullif(btrim(p_email), '') is not null
       and btrim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     )
  then
    raise exception 'academia_info_profile_invalid' using errcode = '22023';
  end if;

  select revision
    into v_current_revision
    from public.academia_profiles
   where organization_id = p_org;
  v_current_revision := coalesce(v_current_revision, 0);

  if v_current_revision <> p_expected_revision then
    raise exception 'academia_info_stale' using errcode = '40001';
  end if;

  v_new_revision := v_current_revision + 1;
  insert into public.academia_profiles(
    organization_id,
    address,
    phone,
    whatsapp,
    email,
    public_rules,
    revision
  ) values (
    p_org,
    nullif(btrim(p_address), ''),
    nullif(btrim(p_phone), ''),
    nullif(btrim(p_whatsapp), ''),
    nullif(btrim(p_email), ''),
    nullif(btrim(p_public_rules), ''),
    v_new_revision
  )
  on conflict (organization_id) do update set
    address = excluded.address,
    phone = excluded.phone,
    whatsapp = excluded.whatsapp,
    email = excluded.email,
    public_rules = excluded.public_rules,
    revision = excluded.revision,
    updated_at = clock_timestamp();

  update public.organizations
     set timezone = p_timezone
   where id = p_org;

  delete from public.academia_opening_hours
   where organization_id = p_org;

  insert into public.academia_opening_hours(
    organization_id,
    weekday,
    opens_at,
    closes_at
  )
  select
    p_org,
    (period->>'weekday')::integer,
    (period->>'opens_at')::time(0),
    (period->>'closes_at')::time(0)
  from jsonb_array_elements(p_periods) as periods(period);

  return v_new_revision;
end;
$$;

revoke all on function public.fn_salvar_academia_info(uuid,integer,text,text,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.fn_salvar_academia_info(uuid,integer,text,text,text,text,text,text,jsonb)
  to authenticated;

notify pgrst, 'reload schema';
