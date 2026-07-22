import { createClient } from "npm:@supabase/supabase-js@2";
import {
  requireSalesOsMember,
  SalesOsAuthError,
} from "../_shared/salesOsAuth.mjs";
import { buildTeamSalesSummary } from "../_shared/teamSalesSummary.mjs";

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
    "Cache-Control": "no-store",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  };
}

function json(status: number, body: Record<string, unknown>, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}

async function readAllFacts(
  admin: ReturnType<typeof createClient>,
  syncId: string,
  ownerEmail: string,
) {
  const rows: Array<Record<string, unknown>> = [];
  const pageSize = 1000;

  for (let from = 0; from < 20_000; from += pageSize) {
    let query = admin
      .from("zoho_deal_facts")
      .select("deal_id,deal_name,stage,associated_platform,wv_percentage,closing_date,created_time,modified_time,last_activity_at,owner_id,owner_name,owner_email,pipeline,layout_id,layout_name")
      .eq("sync_id", syncId)
      .order("deal_id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (ownerEmail) query = query.eq("owner_email", ownerEmail);

    const { data, error } = await query;
    if (error) throw new Error("CACHE_READ_FAILED");
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }

  throw new Error("CACHE_TOO_LARGE");
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
  const memberEmail = member.email;

  const { data: sync, error: syncError } = await admin
    .from("zoho_hit_list_syncs")
    .select("id,generated_at")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (syncError) return json(502, { error: "Cache could not be read" }, origin);
  if (!sync) return json(503, {
    error: "The Zoho cache has not completed its first sync yet",
  }, origin);

  const requestedScope = new URL(request.url).searchParams.get("scope") || "";
  const wantsTeam = requestedScope === "team";
  const wantsSummary = requestedScope === "summary";
  const ownerEmail = wantsTeam && member.role === "manager" ? "" : memberEmail;

  try {
    const rows = await readAllFacts(admin, sync.id, wantsSummary ? "" : ownerEmail);
    const generatedAt = sync.generated_at ? new Date(sync.generated_at).toISOString() : null;
    const ageMs = generatedAt ? Date.now() - Date.parse(generatedAt) : 0;
    if (wantsSummary) {
      const teamSummary = buildTeamSalesSummary(rows);
      return json(200, {
        source: "supabase-cache",
        readOnly: true,
        generatedAt,
        stale: ageMs > 20 * 60 * 1000,
        refreshIntervalMinutes: 10,
        count: teamSummary.reduce((total, row) => total + row.count, 0),
        teamSummary,
      }, origin);
    }
    const deals = rows.map((row) => ({
      id: row.deal_id,
      Deal_Name: row.deal_name,
      Stage: row.stage,
      Associated_Platform: { name: row.associated_platform },
      WV_Percentage: row.wv_percentage,
      Closing_Date: row.closing_date,
      Created_Time: row.created_time,
      Modified_Time: row.modified_time,
      Last_Activity_Time: row.last_activity_at,
      Owner: { id: row.owner_id, name: row.owner_name, email: row.owner_email },
      Pipeline: row.pipeline,
      Layout: { id: row.layout_id, name: row.layout_name },
    }));

    return json(200, {
      source: "supabase-cache",
      readOnly: true,
      generatedAt,
      stale: ageMs > 20 * 60 * 1000,
      refreshIntervalMinutes: 10,
      count: deals.length,
      deals,
    }, origin);
  } catch {
    return json(502, { error: "Cache rows could not be read" }, origin);
  }
});
