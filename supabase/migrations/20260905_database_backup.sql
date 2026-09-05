-- Existing sites: run once before using Data Settings > Load Database.
create or replace function public.restore_admin_data(
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
