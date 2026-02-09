-- =========================
-- Helper functions
-- =========================
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_reviewer()
returns boolean
language sql
stable
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and role = 'reviewer'
  );
$$;

create or replace function public.is_creator()
returns boolean
language sql
stable
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and role = 'creator'
  );
$$;

-- =========================
-- OPTIONAL: Create profile + wallet row on signup
-- =========================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, role, created_at)
  values (new.id, 'creator', now())
  on conflict (id) do nothing;

  insert into public.wallets (user_id, credits, updated_at)
  values (new.id, 0, now())
  on conflict (user_id) do nothing;

  insert into public.reviewer_balances (reviewer_id, pending_cents, available_cents, paid_cents, updated_at)
  values (new.id, 0, 0, 0, now())
  on conflict (reviewer_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- =========================
-- Enable RLS on all tables
-- =========================
alter table public.profiles enable row level security;
alter table public.affiliates enable row level security;
alter table public.affiliate_attributions enable row level security;
alter table public.wallets enable row level security;
alter table public.review_orders enable row level security;
alter table public.reviews enable row level security;
alter table public.reviewer_balances enable row level security;
alter table public.payments enable row level security;
alter table public.reviewer_payout_accounts enable row level security;
alter table public.payout_requests enable row level security;

-- =========================
-- Profiles
-- =========================
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

-- (Optional) allow admins to change roles
drop policy if exists "profiles_admin_update_all" on public.profiles;
create policy "profiles_admin_update_all"
on public.profiles for update
using (public.is_admin())
with check (public.is_admin());

-- =========================
-- Wallets (Creator credits)
-- =========================
drop policy if exists "wallets_select_own" on public.wallets;
create policy "wallets_select_own"
on public.wallets for select
using (user_id = auth.uid() or public.is_admin());

-- IMPORTANT:
-- Do NOT allow clients to arbitrarily update credits.
-- Credits should be updated by server (Edge Function w/ service role) or admin.
drop policy if exists "wallets_admin_update" on public.wallets;
create policy "wallets_admin_update"
on public.wallets for update
using (public.is_admin())
with check (public.is_admin());

-- =========================
-- Affiliates (each user owns their code)
-- =========================
drop policy if exists "affiliates_select_own" on public.affiliates;
create policy "affiliates_select_own"
on public.affiliates for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "affiliates_insert_own" on public.affiliates;
create policy "affiliates_insert_own"
on public.affiliates for insert
with check (user_id = auth.uid());

drop policy if exists "affiliates_update_own" on public.affiliates;
create policy "affiliates_update_own"
on public.affiliates for update
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

-- =========================
-- Affiliate Attributions
-- Who referred a newly signed-up user (referred_user_id)
-- =========================
drop policy if exists "attrib_insert_self" on public.affiliate_attributions;
create policy "attrib_insert_self"
on public.affiliate_attributions for insert
with check (referred_user_id = auth.uid());

drop policy if exists "attrib_select_admin_only" on public.affiliate_attributions;
create policy "attrib_select_admin_only"
on public.affiliate_attributions for select
using (public.is_admin());

-- =========================
-- Review Orders
-- Creator can CRUD their own
-- Reviewer can read open orders
-- =========================
drop policy if exists "orders_creator_select_own" on public.review_orders;
create policy "orders_creator_select_own"
on public.review_orders for select
using (creator_id = auth.uid() or public.is_admin());

drop policy if exists "orders_creator_insert_own" on public.review_orders;
create policy "orders_creator_insert_own"
on public.review_orders for insert
with check (creator_id = auth.uid());

drop policy if exists "orders_creator_update_own" on public.review_orders;
create policy "orders_creator_update_own"
on public.review_orders for update
using (creator_id = auth.uid() or public.is_admin())
with check (creator_id = auth.uid() or public.is_admin());

-- reviewers can view open orders (minimal risk; hosted_url is allowed)
drop policy if exists "orders_reviewer_select_open" on public.review_orders;
create policy "orders_reviewer_select_open"
on public.review_orders for select
using (public.is_reviewer() and status = 'open');

-- =========================
-- Reviews
-- Reviewer inserts their own review
-- Creator can read reviews for their orders
-- Reviewer can read their own
-- Admin can read all
-- =========================
drop policy if exists "reviews_insert_reviewer" on public.reviews;
create policy "reviews_insert_reviewer"
on public.reviews for insert
with check (reviewer_id = auth.uid() and public.is_reviewer());

drop policy if exists "reviews_select_reviewer_own" on public.reviews;
create policy "reviews_select_reviewer_own"
on public.reviews for select
using (reviewer_id = auth.uid() or public.is_admin());

drop policy if exists "reviews_select_creator_orders" on public.reviews;
create policy "reviews_select_creator_orders"
on public.reviews for select
using (
  public.is_admin()
  or exists (
    select 1 from public.review_orders o
    where o.id = reviews.order_id
      and o.creator_id = auth.uid()
  )
);

-- Only admin (or server) should mark approved/paid
drop policy if exists "reviews_admin_update" on public.reviews;
create policy "reviews_admin_update"
on public.reviews for update
using (public.is_admin())
with check (public.is_admin());

-- =========================
-- Reviewer balances
-- Reviewer can read own balance
-- Only admin can update (server uses service role)
-- =========================
drop policy if exists "rb_select_own" on public.reviewer_balances;
create policy "rb_select_own"
on public.reviewer_balances for select
using (reviewer_id = auth.uid() or public.is_admin());

drop policy if exists "rb_admin_update" on public.reviewer_balances;
create policy "rb_admin_update"
on public.reviewer_balances for update
using (public.is_admin())
with check (public.is_admin());

-- =========================
-- Payments
-- User can read their own payments
-- =========================
drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own"
on public.payments for select
using (user_id = auth.uid() or public.is_admin());

-- =========================
-- Reviewer payout accounts (Stripe Connect ids)
-- Reviewer can read/update their own connect record
-- =========================
drop policy if exists "rpa_select_own" on public.reviewer_payout_accounts;
create policy "rpa_select_own"
on public.reviewer_payout_accounts for select
using (reviewer_id = auth.uid() or public.is_admin());

drop policy if exists "rpa_upsert_own" on public.reviewer_payout_accounts;
create policy "rpa_upsert_own"
on public.reviewer_payout_accounts for insert
with check (reviewer_id = auth.uid());

drop policy if exists "rpa_update_own" on public.reviewer_payout_accounts;
create policy "rpa_update_own"
on public.reviewer_payout_accounts for update
using (reviewer_id = auth.uid() or public.is_admin())
with check (reviewer_id = auth.uid() or public.is_admin());

-- =========================
-- Payout requests
-- Reviewer can create and view their own requests
-- Admin can view/update all
-- =========================
drop policy if exists "payout_insert_own" on public.payout_requests;
create policy "payout_insert_own"
on public.payout_requests for insert
with check (reviewer_id = auth.uid() and public.is_reviewer());

drop policy if exists "payout_select_own" on public.payout_requests;
create policy "payout_select_own"
on public.payout_requests for select
using (reviewer_id = auth.uid() or public.is_admin());

drop policy if exists "payout_admin_update" on public.payout_requests;
create policy "payout_admin_update"
on public.payout_requests for update
using (public.is_admin())
with check (public.is_admin());
