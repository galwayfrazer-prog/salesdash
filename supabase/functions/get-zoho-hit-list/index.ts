import { createClient } from "npm:@supabase/supabase-js@2";

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
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(503, { error: "Server is not configured" }, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json(401, { error: "Invalid session" }, origin);
  }
  if (!userData.user.email_confirmed_at) {
    return json(403, { error: "A verified email is required" }, origin);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const memberEmail = userData.user.email?.trim().toLowerCase() || "";
  if (!memberEmail) return json(403, { error: "Approved membership required" }, origin);
  const { data: member, error: memberError } = await admin
    .from("sales_os_members")
    .select("email,user_id,role,active")
    .eq("email", memberEmail)
    .eq("active", true)
    .maybeSingle();
  if (memberError) return json(503, { error: "Membership could not be checked" }, origin);
  if (!member) return json(403, { error: "Approved membership required" }, origin);
  if (member.user_id && member.user_id !== userData.user.id) {
    return json(403, { error: "Membership belongs to another account" }, origin);
  }
  if (!member.user_id) {
    const { error: bindError } = await admin
      .from("sales_os_members")
      .update({ user_id: userData.user.id, updated_at: new Date().toISOString() })
      .eq("email", memberEmail)
      .is("user_id", null);
    if (bindError) return json(503, { error: "Membership could not be linked" }, origin);
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
    .select("row_key,creator_name,live_platform,missing_platform,owner_name,last_activity_at,deal_id,zoho_record_url")
    .eq("sync_id", sync.id)
    .order("creator_name", { ascending: true });
  if (rowsError) return json(502, { error: "Cache rows could not be read" }, origin);

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
      opportunities: sync.opportunities,
      missingSpotify: sync.missing_spotify,
      missingMicrosoftStart: sync.missing_microsoft_start,
    },
    rows: (rows || []).map((row) => ({
      id: row.row_key,
      creator: row.creator_name,
      livePlatform: row.live_platform,
      missingPlatform: row.missing_platform,
      owner: row.owner_name,
      lastActivityAt: row.last_activity_at,
      dealId: row.deal_id,
      zohoRecordUrl: row.zoho_record_url,
    })),
  }, origin);
});
