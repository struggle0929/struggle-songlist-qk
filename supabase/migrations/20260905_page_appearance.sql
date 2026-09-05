-- Existing sites: run once in Supabase SQL Editor before deploying the new version.
begin;
alter table public.settings drop constraint if exists settings_key_check;
alter table public.settings add constraint settings_key_check
  check (key in ('avatar_path', 'background_path', 'hero_title', 'bilibili_url', 'appearance'));
drop policy if exists "public settings are readable" on public.settings;
create policy "public settings are readable" on public.settings for select
  using (key in ('avatar_path', 'background_path', 'hero_title', 'bilibili_url', 'appearance'));
insert into public.settings (key, value) values ('appearance', '') on conflict (key) do nothing;
commit;
