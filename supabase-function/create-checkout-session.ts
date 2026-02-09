import Stripe from "stripe";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET")!);

Deno.serve(async (req) => {

  const { pack } = await req.json();

  const prices = {
    starter: 2500,
    pro: 9900,
    studio: 29900
  };

  const session = await stripe.checkout.sessions.create({
    payment_method_types:["card"],
    line_items:[{
      price_data:{
        currency:"usd",
        product_data:{ name:`${pack} credits` },
        unit_amount: prices[pack]
      },
      quantity:1
    }],
    mode:"payment",
    success_url:"https://yoursite.com",
    cancel_url:"https://yoursite.com"
  });

  return new Response(JSON.stringify({ url: session.url }));
});
