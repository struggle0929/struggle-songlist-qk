create extension if not exists pgcrypto;

create type public.song_language as enum ('中文', '英语', '日语', '其他');
create type public.song_status as enum ('ready', 'learning', 'resting');
create type public.request_status as enum ('pending', 'accepted', 'refused');

create table public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null,
  language public.song_language not null,
  status public.song_status not null,
  tags text[] not null default '{}',
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  song_title text not null,
  artist text not null default '',
  language public.song_language not null,
  message text not null,
  requester_name text,
  status public.request_status not null default 'pending',
  matched_song_id uuid references public.songs (id) on delete set null,
  created_at timestamptz not null default now()
);

create function public.accept_song_request(request_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  request_row public.requests%rowtype;
  new_song_id uuid;
begin
  select *
  into request_row
  from public.requests
  where id = request_id
  for update;

  if not found then
    raise exception '愿望不存在。';
  end if;

  if request_row.status <> 'pending' then
    raise exception '这个愿望已经处理过。';
  end if;

  insert into public.songs (title, artist, language, status, tags, is_public)
  values (request_row.song_title, request_row.artist, request_row.language, 'learning', '{}', true)
  returning id into new_song_id;

  update public.requests
  set status = 'accepted',
      matched_song_id = new_song_id
  where id = request_id;

  return new_song_id;
end;
$$;

revoke all on function public.accept_song_request(uuid) from public, anon, authenticated;
grant execute on function public.accept_song_request(uuid) to service_role;

create function public.create_song_request(
  p_song_title text,
  p_artist text,
  p_language public.song_language,
  p_message text,
  p_requester_name text
)
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into public.requests (song_title, artist, language, message, requester_name)
  values (p_song_title, p_artist, p_language, p_message, nullif(p_requester_name, ''));
end;
$$;

revoke all on function public.create_song_request(text, text, public.song_language, text, text) from public, anon, authenticated;
grant execute on function public.create_song_request(text, text, public.song_language, text, text) to service_role;

alter table public.songs enable row level security;
alter table public.requests enable row level security;

create policy "public songs are readable"
  on public.songs
  for select
  using (is_public = true);

create table public.settings (
  key text primary key,
  value text not null,
  check (key in ('avatar_path', 'background_path', 'hero_title', 'bilibili_url', 'appearance'))
);

alter table public.settings enable row level security;

create policy "public settings are readable"
  on public.settings
  for select
  using (key in ('avatar_path', 'background_path', 'hero_title', 'bilibili_url', 'appearance'));

insert into public.settings (key, value)
values
  ('avatar_path', ''),
  ('background_path', ''),
  ('hero_title', ''),
  ('bilibili_url', 'https://www.bilibili.com/');

create table public.request_rate_limits (
  client_key text primary key,
  request_count integer not null,
  reset_at timestamptz not null
);

alter table public.request_rate_limits enable row level security;

create function public.consume_request_rate_limit(
  p_client_key text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  current_limit public.request_rate_limits%rowtype;
begin
  loop
    select *
    into current_limit
    from public.request_rate_limits
    where client_key = p_client_key
    for update;

    if not found then
      begin
        insert into public.request_rate_limits (client_key, request_count, reset_at)
        values (p_client_key, 1, now() + make_interval(secs => p_window_seconds));
        return true;
      exception
        when unique_violation then
          null;
      end;
    elsif current_limit.reset_at <= now() then
      update public.request_rate_limits
      set request_count = 1,
          reset_at = now() + make_interval(secs => p_window_seconds)
      where client_key = p_client_key;
      return true;
    elsif current_limit.request_count >= p_max_requests then
      return false;
    else
      update public.request_rate_limits
      set request_count = current_limit.request_count + 1
      where client_key = p_client_key;
      return true;
    end if;
  end loop;
end;
$$;

revoke all on function public.consume_request_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_request_rate_limit(text, integer, integer) to service_role;

create function public.reset_admin_data(p_settings jsonb)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from public.requests where id is not null;
  delete from public.songs where id is not null;

  insert into public.settings (key, value)
  select key, value
  from jsonb_each_text(p_settings)
  on conflict (key) do update set value = excluded.value;
end;
$$;

revoke all on function public.reset_admin_data(jsonb) from public, anon, authenticated;
grant execute on function public.reset_admin_data(jsonb) to service_role;

create function public.restore_admin_data(
  p_songs jsonb,
  p_requests jsonb,
  p_settings jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from public.requests where id is not null;
  delete from public.songs where id is not null;
  delete from public.settings where key is not null;

  insert into public.songs (id, title, artist, language, status, tags, is_public, created_at)
  select id, title, artist, language, status, tags, is_public, created_at
  from jsonb_populate_recordset(null::public.songs, p_songs);

  insert into public.requests (
    id, song_title, artist, language, message, requester_name, status, matched_song_id, created_at
  )
  select id, song_title, artist, language, message, requester_name, status, matched_song_id, created_at
  from jsonb_populate_recordset(null::public.requests, p_requests);

  insert into public.settings (key, value)
  select key, value
  from jsonb_each_text(p_settings);
end;
$$;

revoke all on function public.restore_admin_data(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.restore_admin_data(jsonb, jsonb, jsonb) to service_role;

insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true);
