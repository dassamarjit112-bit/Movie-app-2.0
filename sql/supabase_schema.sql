-- ==========================================
-- CineStream Supabase Schema Setup
-- ==========================================

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  is_admin BOOLEAN DEFAULT false,
  admin BOOLEAN DEFAULT false,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Ensure admin columns exist if table was already created
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS admin BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

-- Enable RLS for profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- 2. Watch History Table
CREATE TABLE IF NOT EXISTS public.watch_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content_id TEXT NOT NULL,
  progress_seconds INTEGER DEFAULT 0,
  progress INTEGER DEFAULT 0, -- percentage
  episode TEXT,
  last_watched TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  UNIQUE(user_id, content_id)
);

ALTER TABLE public.watch_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own watch history" ON public.watch_history;
CREATE POLICY "Users can manage their own watch history" ON public.watch_history FOR ALL USING (true);

-- 3. Watchlist Table
CREATE TABLE IF NOT EXISTS public.watchlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content_id TEXT NOT NULL,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  UNIQUE(user_id, content_id)
);

ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own watchlist" ON public.watchlist;
CREATE POLICY "Users can manage their own watchlist" ON public.watchlist FOR ALL USING (true);

-- 4. Subscriptions Table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  source TEXT,
  gift_code_used TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Users can view their own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Anyone authenticated can view subscriptions" ON public.subscriptions;
CREATE POLICY "Anyone authenticated can view subscriptions" ON public.subscriptions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can update their own subscription" ON public.subscriptions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own subscription" ON public.subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 5. Gift Codes Table
CREATE TABLE IF NOT EXISTS public.gift_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  plan_id TEXT NOT NULL,
  duration_days INTEGER DEFAULT 30,
  max_uses INTEGER DEFAULT 1000, -- allow many uses by default
  usage_count INTEGER DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.gift_codes ENABLE ROW LEVEL SECURITY;
-- Users can view gift codes (to validate) and update them (when redeeming)
CREATE POLICY "Users can read gift codes" ON public.gift_codes FOR SELECT USING (true);
CREATE POLICY "Users can update gift codes" ON public.gift_codes FOR UPDATE USING (auth.uid() IS NOT NULL);

-- 6. Content Table (Fallback/Demo Content sync if you plan to use it later)
CREATE TABLE IF NOT EXISTS public.content (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  poster TEXT,
  thumbnail TEXT,
  duration INTEGER,
  type TEXT,
  genre TEXT,
  year INTEGER,
  imdb TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Enable open read access to content
ALTER TABLE public.content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read content" ON public.content FOR SELECT USING (true);
