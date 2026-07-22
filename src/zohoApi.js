import { supabase, supabaseAnonKey, supabaseUrl } from "./supabaseClient.js";

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

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("Secure Supabase sign-in is required before hosted Zoho data can be shown.");
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
