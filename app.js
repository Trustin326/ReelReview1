async function signup(){
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const { error } = await supabase.auth.signUp({ email, password });
  if(error) alert(error.message);
  else alert("Check your email!");
}

async function login(){
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if(error) alert(error.message);
  else showDashboard();
}

function logout(){
  supabase.auth.signOut();
  location.reload();
}

async function showDashboard(){
  document.getElementById("authBox").style.display="none";
  document.getElementById("dashboard").style.display="block";
}

async function buyCredits(pack){
  const res = await fetch("/functions/create-checkout-session", {
    method:"POST",
    body: JSON.stringify({ pack })
  });
  const data = await res.json();
  window.location.href = data.url;
}

async function createOrder(){
  const title = movieTitle.value;
  const url = movieUrl.value;
  const tier = document.getElementById("tier").value;

  await supabase.from("review_orders").insert({
    title,
    hosted_url: url,
    tier
  });

  alert("Order Created");
}

async function loadQueue(){
  const { data } = await supabase
  .from("review_orders")
  .select("*")
  .eq("status","open");

  queue.innerHTML = JSON.stringify(data);
}
