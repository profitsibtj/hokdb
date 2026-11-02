create table if not exists public.hokdb_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.hokdb_admins enable row level security;
revoke all on table public.hokdb_admins from public, anon, authenticated;

create or replace function public.is_hokdb_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.hokdb_admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_hokdb_admin() from public, anon;
grant execute on function public.is_hokdb_admin() to authenticated;

do $$
declare
  function_signature regprocedure;
begin
  for function_signature in
    select p.oid::regprocedure
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'upsert_match',
        'delete_match',
        'upsert_roster_player',
        'delete_roster_player',
        'upsert_schedule',
        'delete_schedule',
        'sync_tournaments'
      ])
  loop
    execute format('drop function %s', function_signature);
  end loop;
end;
$$;

do $$
declare
  function_signature regprocedure;
begin
  for function_signature in
    select p.oid::regprocedure
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'reset_matches_id_seq',
        'reset_roster_id_seq',
        'reset_schedules_id_seq'
      ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', function_signature);
  end loop;
end;
$$;

do $$
declare
  target_table text;
  policy_name text;
begin
  foreach target_table in array array['matches', 'schedules', 'roster', 'tournaments']
  loop
    execute format('alter table public.%I enable row level security', target_table);
    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = target_table
    loop
      execute format('drop policy %I on public.%I', policy_name, target_table);
    end loop;
    execute format('revoke all on table public.%I from public, anon, authenticated', target_table);
    execute format('grant select on table public.%I to authenticated', target_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      target_table || '_authenticated_read',
      target_table
    );
  end loop;

  if to_regclass('public.app_settings') is not null then
    alter table public.app_settings enable row level security;
    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = 'app_settings'
    loop
      execute format('drop policy %I on public.app_settings', policy_name);
    end loop;
    revoke all on table public.app_settings from public, anon, authenticated;
  end if;
end;
$$;

create or replace function public.upsert_match(p_id bigint, p_row jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id bigint;
begin
  if not public.is_hokdb_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.matches (
      league, stage, format, team_a, team_b, score_a, score_b, winner,
      scheduled_at, live_link, patch, is_playoff, is_finished, games, updated_at
    ) values (
      nullif(p_row->>'league', ''),
      nullif(p_row->>'stage', ''),
      nullif(p_row->>'format', ''),
      nullif(p_row->>'team_a', ''),
      nullif(p_row->>'team_b', ''),
      coalesce(nullif(p_row->>'score_a', '')::integer, 0),
      coalesce(nullif(p_row->>'score_b', '')::integer, 0),
      nullif(p_row->>'winner', ''),
      nullif(p_row->>'scheduled_at', '')::timestamptz,
      nullif(p_row->>'live_link', ''),
      nullif(p_row->>'patch', ''),
      coalesce((p_row->>'is_playoff')::boolean, false),
      coalesce((p_row->>'is_finished')::boolean, false),
      case when jsonb_typeof(p_row->'games') = 'array' then p_row->'games' else '[]'::jsonb end,
      now()
    )
    returning id into saved_id;
  else
    update public.matches
    set league = nullif(p_row->>'league', ''),
        stage = nullif(p_row->>'stage', ''),
        format = nullif(p_row->>'format', ''),
        team_a = nullif(p_row->>'team_a', ''),
        team_b = nullif(p_row->>'team_b', ''),
        score_a = coalesce(nullif(p_row->>'score_a', '')::integer, 0),
        score_b = coalesce(nullif(p_row->>'score_b', '')::integer, 0),
        winner = nullif(p_row->>'winner', ''),
        scheduled_at = nullif(p_row->>'scheduled_at', '')::timestamptz,
        live_link = nullif(p_row->>'live_link', ''),
        patch = nullif(p_row->>'patch', ''),
        is_playoff = coalesce((p_row->>'is_playoff')::boolean, false),
        is_finished = coalesce((p_row->>'is_finished')::boolean, false),
        games = case when jsonb_typeof(p_row->'games') = 'array' then p_row->'games' else '[]'::jsonb end,
        updated_at = now()
    where id = p_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'Match % not found', p_id using errcode = 'P0002';
    end if;
  end if;

  return saved_id;
end;
$$;

create or replace function public.delete_match(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_hokdb_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  delete from public.matches where id = p_id;
end;
$$;

create or replace function public.upsert_roster_player(p_id bigint, p_row jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id bigint;
begin
  if not public.is_hokdb_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.roster (
      name, position, secondary_position, team, league, previous_names, real_name, updated_at
    ) values (
      coalesce(nullif(p_row->>'name', ''), ''),
      nullif(p_row->>'position', ''),
      nullif(p_row->>'secondary_position', ''),
      nullif(p_row->>'team', ''),
      nullif(p_row->>'league', ''),
      case when jsonb_typeof(p_row->'previous_names') = 'array' then p_row->'previous_names' else '[]'::jsonb end,
      nullif(p_row->>'real_name', ''),
      now()
    )
    returning id into saved_id;
  else
    update public.roster
    set name = coalesce(nullif(p_row->>'name', ''), ''),
        position = nullif(p_row->>'position', ''),
        secondary_position = nullif(p_row->>'secondary_position', ''),
        team = nullif(p_row->>'team', ''),
        league = nullif(p_row->>'league', ''),
        previous_names = case when jsonb_typeof(p_row->'previous_names') = 'array' then p_row->'previous_names' else '[]'::jsonb end,
        real_name = nullif(p_row->>'real_name', ''),
        updated_at = now()
    where id = p_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'Roster player % not found', p_id using errcode = 'P0002';
    end if;
  end if;

  return saved_id;
end;
$$;

create or replace function public.delete_roster_player(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_hokdb_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  delete from public.roster where id = p_id;
end;
$$;

create or replace function public.upsert_schedule(p_id bigint, p_row jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id bigint;
begin
  if not public.is_hokdb_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.schedules (
      league, match_code, team_a, team_b, format, scheduled_at, live_link, is_finished
    ) values (
      nullif(p_row->>'league', ''),
      nullif(p_row->>'match_code', ''),
      nullif(p_row->>'team_a', ''),
      nullif(p_row->>'team_b', ''),
      nullif(p_row->>'format', ''),
      nullif(p_row->>'scheduled_at', '')::timestamptz,
      nullif(p_row->>'live_link', ''),
      coalesce((p_row->>'is_finished')::boolean, false)
    )
    returning id into saved_id;
  else
    update public.schedules
    set league = nullif(p_row->>'league', ''),
        match_code = nullif(p_row->>'match_code', ''),
        team_a = nullif(p_row->>'team_a', ''),
        team_b = nullif(p_row->>'team_b', ''),
        format = nullif(p_row->>'format', ''),
        scheduled_at = nullif(p_row->>'scheduled_at', '')::timestamptz,
        live_link = nullif(p_row->>'live_link', ''),
        is_finished = coalesce((p_row->>'is_finished')::boolean, false)
    where id = p_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'Schedule % not found', p_id using errcode = 'P0002';
    end if;
  end if;

  return saved_id;
end;
$$;

create or replace function public.delete_schedule(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_hokdb_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  delete from public.schedules where id = p_id;
end;
$$;

create or replace function public.sync_tournaments(p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tournament_row jsonb;
begin
  if not public.is_hokdb_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Tournament rows must be a JSON array' using errcode = '22023';
  end if;

  for tournament_row in select value from jsonb_array_elements(p_rows)
  loop
    if nullif(tournament_row->>'id', '') is null then
      raise exception 'Tournament id is required' using errcode = '22023';
    end if;
    insert into public.tournaments (id, data, updated_at)
    values (
      tournament_row->>'id',
      case when jsonb_typeof(tournament_row->'data') = 'object' then tournament_row->'data' else '{}'::jsonb end,
      now()
    )
    on conflict (id) do update
      set data = excluded.data, updated_at = now();
  end loop;

  delete from public.tournaments as existing
  where not exists (
    select 1
    from jsonb_array_elements(p_rows) as submitted(value)
    where submitted.value->>'id' = existing.id
  );
end;
$$;

revoke all on function public.upsert_match(bigint, jsonb) from public, anon;
revoke all on function public.delete_match(bigint) from public, anon;
revoke all on function public.upsert_roster_player(bigint, jsonb) from public, anon;
revoke all on function public.delete_roster_player(bigint) from public, anon;
revoke all on function public.upsert_schedule(bigint, jsonb) from public, anon;
revoke all on function public.delete_schedule(bigint) from public, anon;
revoke all on function public.sync_tournaments(jsonb) from public, anon;

grant execute on function public.upsert_match(bigint, jsonb) to authenticated;
grant execute on function public.delete_match(bigint) to authenticated;
grant execute on function public.upsert_roster_player(bigint, jsonb) to authenticated;
grant execute on function public.delete_roster_player(bigint) to authenticated;
grant execute on function public.upsert_schedule(bigint, jsonb) to authenticated;
grant execute on function public.delete_schedule(bigint) to authenticated;
grant execute on function public.sync_tournaments(jsonb) to authenticated;
