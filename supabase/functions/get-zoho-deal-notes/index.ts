import { createClient } from "npm:@supabase/supabase-js@2";
import {
  requireSalesOsMember,
  SalesOsAuthError,
} from "../_shared/salesOsAuth.mjs";
import {
  canReadDealNotes,
  sanitizeZohoNotes,
  validZohoDealId,
} from "../_shared/dealNotes.mjs";
import { fetchJsonWithRetry } from "../_shared/fetchJson.mjs";

const DEFAULT_ACCOUNTS_DOMAIN = "https://accounts.zoho.eu";
const DEFAULT_API_DOMAIN = "https://www.zohoapis.eu";
const NOTES_SCOPE = "ZohoCRM.modules.deals.READ,ZohoCRM.modules.notes.READ";

function env(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

function allowedOrigin(request: Request) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return "";
  const allowed = env("SALES_OS_ALLOWED_ORIGINS")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function responseHeaders(origin: string) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  };
}

function json(status: number, body: Record<string, unknown>, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}

async function getZohoAccessToken() {
  const clientId = env("ZOHO_CLIENT_ID");
  const clientSecret = env("ZOHO_CLIENT_SECRET");
  const refreshToken = env("ZOHO_REFRESH_TOKEN");
  const orgId = env("ZOHO_CRM_ORG_ID");
  if (!clientId || !clientSecret || (!refreshToken && !orgId)) {
    throw new Error("CONFIG_MISSING");
  }

  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });
  if (refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
  } else {
    body.set("grant_type", "client_credentials");
    body.set("scope", NOTES_SCOPE);
    body.set("soid", `ZohoCRM.${orgId}`);
  }

  const accountsDomain = (env("ZOHO_ACCOUNTS_DOMAIN") || DEFAULT_ACCOUNTS_DOMAIN)
    .replace(/\/$/, "");
  const { response, payload } = await fetchJsonWithRetry(`${accountsDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok || !payload.access_token) throw new Error("ZOHO_AUTH_FAILED");

  return {
    accessToken: String(payload.access_token),
    apiDomain: String(payload.api_domain || env("ZOHO_API_DOMAIN") || DEFAULT_API_DOMAIN)
      .replace(/\/$/, ""),
  };
}

async function readDealNotes(dealId: string) {
  const auth = await getZohoAccessToken();
  const notes: Array<Record<string, unknown>> = [];

  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(`${auth.apiDomain}/crm/v8/Deals/${dealId}/Notes`);
    url.searchParams.set(
      "fields",
      "Note_Title,Note_Content,Created_Time,Modified_Time,Created_By,Modified_By",
    );
    url.searchParams.set("per_page", "200");
    url.searchParams.set("page", String(page));
    const { response, payload } = await fetchJsonWithRetry(url, {
      headers: { Authorization: `Zoho-oauthtoken ${auth.accessToken}` },
    });
    if (response.status === 204) return notes;
    if (!response.ok) throw new Error(
      response.status === 401 || response.status === 403
        ? "NOTES_PERMISSION_MISSING"
        : "ZOHO_NOTES_READ_FAILED",
    );
    notes.push(...sanitizeZohoNotes(payload));
    if (!payload.info?.more_records) return notes;
  }

  throw new Error("ZOHO_NOTES_TOO_LARGE");
}

Deno.serve(async (request) => {
  const origin = allowedOrigin(request);
  if (origin === null) return json(403, { error: "Origin not allowed" });

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...responseHeaders(origin),
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }
  if (request.method !== "GET") return json(405, { error: "GET required" }, origin);

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return json(401, { error: "Authentication required" }, origin);
  }

  const dealId = new URL(request.url).searchParams.get("dealId") || "";
  if (!validZohoDealId(dealId)) {
    return json(400, { error: "A valid Zoho Deal is required" }, origin);
  }

  const supabaseUrl = env("SUPABASE_URL");
  const anonKey = env("SUPABASE_ANON_KEY");
  const adminKey = env("SALES_OS_SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !adminKey) {
    return json(503, { error: "Server is not configured" }, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let member;
  try {
    ({ member } = await requireSalesOsMember({ userClient, admin }));
  } catch (error) {
    if (error instanceof SalesOsAuthError) {
      return json(error.status, { error: error.message }, origin);
    }
    return json(503, { error: "Membership could not be checked" }, origin);
  }

  const { data: sync, error: syncError } = await admin
    .from("zoho_hit_list_syncs")
    .select("id")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (syncError) return json(502, { error: "Zoho cache could not be read" }, origin);
  if (!sync) return json(503, { error: "Zoho has not completed its first sync" }, origin);

  const { data: deal, error: dealError } = await admin
    .from("zoho_deal_facts")
    .select("deal_id,deal_name,owner_email")
    .eq("sync_id", sync.id)
    .eq("deal_id", dealId)
    .maybeSingle();
  if (dealError) return json(502, { error: "Deal access could not be checked" }, origin);
  if (!deal) return json(404, { error: "Deal not found" }, origin);
  if (!canReadDealNotes(member, deal)) {
    return json(403, { error: "You can only read notes for your own Deals" }, origin);
  }

  try {
    const notes = await readDealNotes(dealId);
    return json(200, {
      source: "zoho",
      readOnly: true,
      deal: { id: deal.deal_id, name: deal.deal_name },
      count: notes.length,
      notes,
    }, origin);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOTES_PERMISSION_MISSING") {
      return json(503, { error: "The Zoho connection does not have notes permission" }, origin);
    }
    return json(502, { error: "Zoho Deal notes could not be loaded" }, origin);
  }
});
