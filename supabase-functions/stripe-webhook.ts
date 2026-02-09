// supabase-functions/stripe-webhook.ts
import Stripe from "stripe";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// minimal supabase REST helper (service role bypasses RLS)
async function sb(sqlPath: string, method: string, body?: any) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${sqlPath}`, {
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
  if (!res.ok) throw new Error(`Supabase REST error ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : null;
}

function creditsForPack(pack: string): number {
  // you can change these anytime
  switch (pack) {
    case "starter": return 25;
    case "pro": return 120;
    case "studio": return 400;
    default: return 0;
  }
}

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!sig || !endpointSecret) return new Response("Missing webhook signature/secret", { status: 400 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    return new Response(`Webhook signature verification failed`, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const userId = (session.metadata?.user_id || "").trim();
      const pack = (session.metadata?.pack || "").trim();
      const affiliateCode = (session.metadata?.affiliate_code || "").trim(); // optional

      if (!userId || !pack) throw new Error("Missing metadata user_id/pack");

      const credits = creditsForPack(pack);
      const amountCents = session.amount_total ?? 0;

      // Upsert payments row
      await sb(`payments?stripe_session_id=eq.${session.id}`, "GET");
      // Insert payment (ignore duplicates by checking first)
      const existing = await sb(`payments?select=id&stripe_session_id=eq.${session.id}`, "GET");
      if (!existing || existing.length === 0) {
        await sb("payments", "POST", [{
          user_id: userId,
          stripe_session_id: session.id,
          amount_cents: amountCents,
          credits_granted: credits,
          status: "paid"
        }]);
      }

      // Add credits to wallet
      const wallet = await sb(`wallets?select=user_id,credits&user_id=eq.${userId}`, "GET");
      const currentCredits = wallet?.[0]?.credits ?? 0;

      if (!wallet || wallet.length === 0) {
        await sb("wallets", "POST", [{ user_id: userId, credits, updated_at: new Date().toISOString() }]);
      } else {
        await sb(`wallets?user_id=eq.${userId}`, "PATCH", { credits: currentCredits + credits, updated_at: new Date().toISOString() });
      }

      // Affiliate commission (first purchase only)
      // If you store attribution at signup: affiliate_attributions(referred_user_id, affiliate_code)
      // We'll prefer that; fallback to metadata affiliate_code.
      let code = affiliateCode;
      const attrib = await sb(`affiliate_attributions?select=affiliate_code&referred_user_id=eq.${userId}&order=created_at.desc&limit=1`, "GET");
      if (attrib?.[0]?.affiliate_code) code = attrib[0].affiliate_code;

      if (code) {
        // Determine tier (starter/pro/power)
        const aff = await sb(`affiliates?select=tier&code=eq.${encodeURIComponent(code)}&limit=1`, "GET");
        const tier = aff?.[0]?.tier ?? "starter";
        const rate = tier === "power" ? 0.25 : tier === "pro" ? 0.20 : 0.10;
        const commission = Math.round(amountCents * rate);

        await sb("affiliate_commissions", "POST", [{
          affiliate_code: code,
          referred_user_id: userId,
          amount_cents: commission,
          status: "earned",
          stripe_session_id: session.id
        }]);
      }
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    return new Response(`Webhook handler error: ${(err as Error).message}`, { status: 500 });
  }
});
