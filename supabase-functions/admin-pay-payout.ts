// supabase-functions/admin-pay-payout.ts
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
  const { payout_request_id } = await req.json();
  if (!payout_request_id) return new Response("Missing payout_request_id", { status: 400 });

  const pr = await sb(`payout_requests?select=id,reviewer_id,amount_cents,status&իդ=eq.${payout_request_id}`, "GET")
    .catch(() => null);

  // safer fetch:
  const pr2 = await sb(`payout_requests?select=id,reviewer_id,amount_cents,status&id=eq.${payout_request_id}&limit=1`, "GET");
  if (!pr2?.[0]) return new Response("Payout request not found", { status: 404 });
  const payout = pr2[0];
  if (payout.status !== "requested") return new Response("Payout not in requested state", { status: 400 });

  const reviewerId = payout.reviewer_id;

  const acct = await sb(`reviewer_payout_accounts?select=stripe_connect_id,onboarding_status&reviewer_id=eq.${reviewerId}&limit=1`, "GET");
  const connectId = acct?.[0]?.stripe_connect_id;
  if (!connectId) return new Response("Reviewer not connected", { status: 400 });

  // (Optional) Ensure available balance exists
  const bal = await sb(`reviewer_balances?select=available_cents,paid_cents&reviewer_id=eq.${reviewerId}&limit=1`, "GET");
  const available = bal?.[0]?.available_cents ?? 0;
  if (available < payout.amount_cents) return new Response("Insufficient available balance", { status: 400 });

  // Pay reviewer using Transfer (platform -> connected account).
  // NOTE: Your Stripe account must be configured for Connect + balance.
  const transfer = await stripe.transfers.create({
    amount: payout.amount_cents,
    currency: "usd",
    destination: connectId,
    description: `ReelReview payout #${payout_request_id}`
  });

  // Update balances + payout status
  await sb(`reviewer_balances?reviewer_id=eq.${reviewerId}`, "PATCH", {
    available_cents: available - payout.amount_cents,
    paid_cents: (bal?.[0]?.paid_cents ?? 0) + payout.amount_cents,
    updated_at: new Date().toISOString()
  });

  await sb(`payout_requests?id=eq.${payout_request_id}`, "PATCH", {
    status: "paid"
  });

  return new Response(JSON.stringify({ ok: true, transfer_id: transfer.id }), {
    headers: { "Content-Type": "application/json" }
  });
});
