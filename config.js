const SUPABASE_URL = "PASTE_SUPABASE_URL";
const SUPABASE_ANON = "PASTE_SUPABASE_ANON_KEY";

const supabase = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON
);
