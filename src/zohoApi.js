import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export async function fetchZohoData(functionName, searchParams = {}) {
  const query = new URLSearchParams(searchParams);

  if (import.meta.env.DEV) {
    const response = await fetch(`/api/${functionName}?${query}`, {
      method: "GET",
      credentials: "same-origin",
      headers: { "X-WV-Local-Request": "sales-os" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Zoho data could not be loaded.");
    return payload;
  }

  if (!supabase) {
    throw new Error("The secure Supabase connection is not configured.");
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error("Secure Supabase sign-in is required before hosted Zoho data can be shown.");
  }

  const response = await fetch(
    `${supabaseUrl}/functions/v1/get-${functionName}?${query}`,
    {
      method: "GET",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Zoho data could not be loaded.");
  return payload;
}
