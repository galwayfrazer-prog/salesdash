import { createClient } from "npm:@supabase/supabase-js@2";
import {
  requireSalesOsMember,
  SalesOsAuthError,
} from "../_shared/salesOsAuth.mjs";

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
  try {
    await requireSalesOsMember({ userClient, admin });
  } catch (error) {
    if (error instanceof SalesOsAuthError) {
      return json(error.status, { error: error.message }, origin);
    }
    return json(503, { error: "Membership could not be checked" }, origin);
  }

  const { data: sync, error: syncError } = await admin
    .from("zoho_hit_list_syncs")
    .select("id,generated_at,deals_scanned,opportunities,missing_spotify,missing_microsoft_start")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (syncError) return json(502, { error: "Cache could not be read" }, origin);
  if (!sync) return json(503, {
    error: "The Zoho cache has not completed its first sync yet",
  }, origin);

  const { data: rows, error: rowsError } = await admin
    .from("zoho_hit_list_rows")
    .select("row_key,creator_name,live_platform,current_platforms,missing_platform,owner_name,last_activity_at,deal_id,zoho_record_url")
    .eq("sync_id", sync.id)
    .order("creator_name", { ascending: true });
  if (rowsError) return json(502, { error: "Cache rows could not be read" }, origin);

  const { data: dismissals, error: dismissalsError } = await admin
    .from("hit_list_dismissals")
    .select("row_key,dismissed_at,dismissed_by_email");
  if (dismissalsError) return json(502, { error: "Completed rows could not be read" }, origin);
  const dismissalByRow = new Map((dismissals || []).map((row) => [row.row_key, row]));
  const currentRowKeys = new Set((rows || []).map((row) => row.row_key));
  const completedCount = [...dismissalByRow.keys()].filter((rowKey) => currentRowKeys.has(rowKey)).length;

  const generatedAt = sync.generated_at ? new Date(sync.generated_at).toISOString() : null;
  const ageMs = generatedAt ? Date.now() - Date.parse(generatedAt) : 0;
  return json(200, {
    source: "supabase-cache",
    readOnly: true,
    generatedAt,
    stale: ageMs > 20 * 60 * 1000,
    refreshIntervalMinutes: 10,
    counts: {
      dealsScanned: sync.deals_scanned,
      opportunities: (rows || []).filter((row) => !dismissalByRow.has(row.row_key)).length,
      missingSpotify: (rows || []).filter((row) => row.missing_platform === "Spotify" && !dismissalByRow.has(row.row_key)).length,
      missingMicrosoftStart: (rows || []).filter((row) => row.missing_platform === "Microsoft Start" && !dismissalByRow.has(row.row_key)).length,
      completed: completedCount,
    },
    rows: (rows || []).map((row) => {
      const dismissal = dismissalByRow.get(row.row_key);
      return {
        id: row.row_key,
        creator: row.creator_name,
        livePlatform: row.live_platform,
        currentPlatforms: row.current_platforms || [],
        missingPlatform: row.missing_platform,
        owner: row.owner_name,
        lastActivityAt: row.last_activity_at,
        dealId: row.deal_id,
        zohoRecordUrl: row.zoho_record_url,
        completed: Boolean(dismissal),
        completedAt: dismissal?.dismissed_at || "",
        completedBy: dismissal?.dismissed_by_email || "",
      };
    }),
  }, origin);
});
