-- =========================================================================
-- CineStream Supabase Schema (Fully Functional Update)
-- Run this entire script in your Supabase SQL Editor.
-- It will safely recreate the missing columns and fix the RLS policies.
-- =========================================================================

-- 1. Profiles Table (Fixing any missing RLS)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  avatar_url text,
  is_admin boolean default false,
  admin boolean default false,
  role text default 'user',
  updated_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles add column if not exists is_admin boolean default false;
alter table public.profiles add column if not exists admin boolean default false;
alter table public.profiles add column if not exists role text default 'user';

alter table public.profiles enable row level security;
drop policy if exists "Public profiles are viewable by everyone" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Public profiles are viewable by everyone" 
  on public.profiles for select using (true);
create policy "Users can update their own profile" 
  on public.profiles for update using (auth.uid() = id);

-- Trigger for new users
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'CineStream User'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =========================================================================
-- 2. Subscriptions Table
-- Fixed RLS to include `WITH CHECK` for INSERTS to work.
create table if not exists public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  plan_id text not null, 
  status text not null, 
  start_date timestamp with time zone not null default now(),
  end_date timestamp with time zone not null,
  source text not null default 'payment', 
  gift_code_used text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone
);

alter table public.subscriptions enable row level security;
drop policy if exists "Users can view their own subscriptions" on public.subscriptions;
drop policy if exists "Service role or System can manage subscriptions" on public.subscriptions;
drop policy if exists "Users can manage their own subscriptions" on public.subscriptions;

-- Let users insert/view their own subscriptions
create policy "Users can manage their own subscriptions" 
  on public.subscriptions for all 
  using (auth.uid() = user_id) 
  with check (auth.uid() = user_id);

-- =========================================================================
-- 3. Gift Codes Table
-- Added missing `usage_count` and `max_uses` columns expected by frontend.
create table if not exists public.gift_codes (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,
  plan_id text not null,
  duration_days integer not null default 30,
  usage_count integer not null default 0,
  max_uses integer not null default 1,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Safely add columns if the table already existed from before
alter table public.gift_codes add column if not exists usage_count integer not null default 0;
alter table public.gift_codes add column if not exists max_uses integer not null default 1;

alter table public.gift_codes enable row level security;
drop policy if exists "Anyone authenticated can select gift codes" on public.gift_codes;
drop policy if exists "Anyone authenticated can update gift codes to redeem" on public.gift_codes;

create policy "Anyone authenticated can select gift codes" 
  on public.gift_codes for select using (auth.role() = 'authenticated');
create policy "Anyone authenticated can update gift codes to redeem" 
  on public.gift_codes for update using (auth.role() = 'authenticated');

-- Insert demo gift codes
insert into public.gift_codes (code, plan_id, duration_days, max_uses) 
values 
('CINE30BASIC', 'basic', 30, 999),
('CINE30STANDARD', 'standard', 30, 999),
('CINE30PREMIUM', 'premium', 30, 999),
('CINE90PREMIUM', 'premium', 90, 999)
on conflict (code) do nothing;

-- =========================================================================
-- 4. Watch History Table
-- Added missing `content_type` and `episode` columns expected by frontend.
create table if not exists public.watch_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  content_id text not null,
  progress_seconds integer not null default 0,
  content_type text default 'movie',
  episode text,
  last_watched timestamp with time zone not null default now(),
  unique(user_id, content_id)
);

-- Safely add columns if the table already existed from before
alter table public.watch_history add column if not exists content_type text default 'movie';
alter table public.watch_history add column if not exists episode text;

alter table public.watch_history enable row level security;
drop policy if exists "Users can manage their own watch history" on public.watch_history;

create policy "Users can manage their own watch history" 
  on public.watch_history for all 
  using (auth.uid() = user_id) 
  with check (auth.uid() = user_id);

-- =========================================================================
-- 5. Watchlist Table
-- Fixed RLS `WITH CHECK` constraint so INSERTS work
create table if not exists public.watchlist (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  content_id text not null,
  added_at timestamp with time zone not null default now(),
  unique(user_id, content_id)
);

alter table public.watchlist enable row level security;
drop policy if exists "Users can manage their own watchlist" on public.watchlist;

create policy "Users can manage their own watchlist" 
  on public.watchlist for all 
  using (auth.uid() = user_id) 
  with check (auth.uid() = user_id);
