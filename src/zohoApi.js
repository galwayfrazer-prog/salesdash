import { supabase, supabaseAnonKey, supabaseUrl } from "./supabaseClient.js";
import { createAuthorizedFunctionRequester } from "./sessionRecovery.js";

const ALLOWED_FUNCTIONS = new Set([
  "zoho-hit-list",
  "zoho-sales-deals",
]);
const hostedRequest = supabase
  ? createAuthorizedFunctionRequester({
      auth: supabase.auth,
      baseUrl: `${supabaseUrl}/functions/v1/`,
      apiKey: supabaseAnonKey,
    })
  : null;

export async function fetchZohoData(functionName, searchParams = {}) {
  if (!ALLOWED_FUNCTIONS.has(functionName)) {
    throw new Error("This Sales OS data request is not allowed.");
  }
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

  if (!hostedRequest) {
    throw new Error("The secure Supabase connection is not configured.");
  }
  return hostedRequest(`get-${functionName}?${query}`);
}
