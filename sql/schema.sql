-- Profiles
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'creator' check (role in ('creator','reviewer','admin')),
  display_name text,
  created_at timestamp with time zone default now()
);

-- Affiliate tracking
create table if not exists affiliates (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text unique not null,
  tier text not null default 'starter' check (tier in ('starter','pro','power')),
  created_at timestamp with time zone default now()
);

create table if not exists affiliate_attributions (
  id bigserial primary key,
  referred_user_id uuid references auth.users(id) on delete set null,
  affiliate_code text,
  created_at timestamp with time zone default now()
);

-- Creator credit wallet
create table if not exists wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits integer not null default 0,
  updated_at timestamp with time zone default now()
);

-- Review orders ("uploads")
create table if not exists review_orders (
  id bigserial primary key,
  creator_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  hosted_url text not null,
  length_minutes integer not null,
  tier text not null check (tier in ('short','standard','long','feature','full')),
  reviews_requested integer not null default 10,
  reviews_completed integer not null default 0,
  reviewer_pay_cents integer not null,
  status text not null default 'open' check (status in ('open','closed','paused')),
  created_at timestamp with time zone default now()
);

-- Reviews submitted by reviewers
create table if not exists reviews (
  id bigserial primary key,
  order_id bigint not null references review_orders(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  review_text text not null,
  pay_cents integer not null,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','paid')),
  created_at timestamp with time zone default now()
);

-- Reviewer earnings ledger
create table if not exists reviewer_balances (
  reviewer_id uuid primary key references auth.users(id) on delete cascade,
  pending_cents integer not null default 0,
  available_cents integer not null default 0,
  paid_cents integer not null default 0,
  updated_at timestamp with time zone default now()
);

-- Stripe transactions in (creator buys credits)
create table if not exists payments (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  stripe_session_id text unique,
  amount_cents integer not null,
  credits_granted integer not null default 0,
  status text not null default 'pending' check (status in ('pending','paid','failed')),
  created_at timestamp with time zone default now()
);

-- Stripe Connect account for reviewers (payouts)
create table if not exists reviewer_payout_accounts (
  reviewer_id uuid primary key references auth.users(id) on delete cascade,
  stripe_connect_id text unique,
  onboarding_status text not null default 'not_started' check (onboarding_status in ('not_started','pending','complete'))
);

-- Payout requests
create table if not exists payout_requests (
  id bigserial primary key,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null,
  status text not null default 'requested' check (status in ('requested','processing','paid','denied')),
  created_at timestamp with time zone default now()
);
