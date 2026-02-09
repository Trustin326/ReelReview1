// supabase-functions/create-connect-account.ts
import Stripe from "stripe";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sb(path: string, method: string, body?: any) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SERVICE_ROLE,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Prefer": "return=representation"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(txt);
  return txt ? JSON.parse(txt) : null;
}

Deno.serve(async (req) => {
  const { reviewer_id, return_url, refresh_url } = await req.json();

  if (!reviewer_id) return new Response("Missing reviewer_id", { status: 400 });

  // find existing connect account
  const existing = await sb(`reviewer_payout_accounts?select=stripe_connect_id,onboarding_status&reviewer_id=eq.${reviewer_id}&limit=1`, "GET");
  let connectId = existing?.[0]?.stripe_connect_id;

  if (!connectId) {
    const acct = await stripe.accounts.create({
      type: "express"
    });
    connectId = acct.id;

    await sb("reviewer_payout_accounts", "POST", [{
      reviewer_id,
      stripe_connect_id: connectId,
      onboarding_status: "pending"
    }]);
  }

  const link = await stripe.accountLinks.create({
    account: connectId,
    refresh_url: refresh_url || return_url,
    return_url: return_url,
    type: "account_onboarding"
  });

  return new Response(JSON.stringify({ url: link.url, stripe_connect_id: connectId }), {
    headers: { "Content-Type": "application/json" }
  });
});
