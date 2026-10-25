-- ZUZU database. Run once in Supabase -> SQL Editor.
create table public.stories (
  id bigint generated always as identity primary key,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  title text not null check (char_length(title) between 3 and 150),
  category text not null default 'Essays',
  excerpt text not null,
  body text not null check (char_length(body) <= 20000),
  image_url text check (image_url is null or image_url ~* '^https://'),
  read_min int not null default 1,
  created_at timestamptz not null default now());
create table public.likes (story_id bigint references public.stories(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, primary key (story_id, user_id));
create table public.saves (story_id bigint references public.stories(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, primary key (story_id, user_id));
create table public.comments (
  id bigint generated always as identity primary key,
  story_id bigint not null references public.stories(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null,
  text text not null check (char_length(text) between 1 and 1000),
  created_at timestamptz not null default now());
create table public.support_messages (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 80),
  email text not null check (char_length(email) between 5 and 120),
  message text not null check (char_length(message) between 5 and 2000),
  user_id uuid default auth.uid(),
  status text not null default 'new',
  created_at timestamptz not null default now());

alter table public.stories enable row level security;
alter table public.likes enable row level security;
alter table public.saves enable row level security;
alter table public.comments enable row level security;
alter table public.support_messages enable row level security;

create policy "anyone reads stories" on public.stories for select using (true);
create policy "write own stories" on public.stories for insert to authenticated with check (author_id = auth.uid());
create policy "edit own stories" on public.stories for update to authenticated using (author_id = auth.uid());
create policy "delete own stories" on public.stories for delete to authenticated using (author_id = auth.uid());
create policy "anyone reads likes" on public.likes for select using (true);
create policy "add own like" on public.likes for insert to authenticated with check (user_id = auth.uid());
create policy "remove own like" on public.likes for delete to authenticated using (user_id = auth.uid());
create policy "read own saves" on public.saves for select to authenticated using (user_id = auth.uid());
create policy "add own save" on public.saves for insert to authenticated with check (user_id = auth.uid());
create policy "remove own save" on public.saves for delete to authenticated using (user_id = auth.uid());
create policy "anyone reads comments" on public.comments for select using (true);
create policy "add own comment" on public.comments for insert to authenticated with check (user_id = auth.uid());
create policy "delete own comment" on public.comments for delete to authenticated using (user_id = auth.uid());
-- Anyone may SEND a support message; nobody can read them through the website.
-- You (the project owner) read them in Supabase -> Table Editor -> support_messages.
create policy "anyone sends support" on public.support_messages for insert to anon, authenticated with check (true);

-- ===== Admin feedback inbox (admin.html) =====
create table public.admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.admins enable row level security;
create policy "admin sees own row" on public.admins for select to authenticated using (user_id = auth.uid());
create policy "admins read feedback" on public.support_messages for select to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));
create policy "admins update feedback" on public.support_messages for update to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));
-- After you create YOUR account on the site, run this ONCE (put your email):
-- insert into public.admins select id from auth.users where email = 'alwaysahmedansari@gmail.com';
