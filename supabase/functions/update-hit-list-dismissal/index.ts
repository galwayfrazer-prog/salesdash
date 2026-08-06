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

function headers(origin: string) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  };
}

function json(status: number, body: Record<string, unknown>, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

Deno.serve(async (request) => {
  const origin = allowedOrigin(request);
  if (origin === null) return json(403, { error: "Origin not allowed" });
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers(origin),
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }
  if (request.method !== "POST") return json(405, { error: "POST required" }, origin);

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json(401, { error: "Authentication required" }, origin);

  const supabaseUrl = env("SUPABASE_URL");
  const anonKey = env("SUPABASE_ANON_KEY");
  const adminKey = env("SALES_OS_SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !adminKey) return json(503, { error: "Server is not configured" }, origin);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let auth;
  try {
    auth = await requireSalesOsMember({ userClient, admin });
  } catch (error) {
    if (error instanceof SalesOsAuthError) return json(error.status, { error: error.message }, origin);
    return json(503, { error: "Membership could not be checked" }, origin);
  }

  const payload = await request.json().catch(() => ({}));
  const rowKey = String(payload?.rowKey || "").trim();
  const completed = payload?.completed === true;
  if (!rowKey || rowKey.length > 300) return json(400, { error: "A valid Hit List row is required" }, origin);

  const { data: latestSync } = await admin
    .from("zoho_hit_list_syncs")
    .select("id")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latestSync) return json(409, { error: "The Hit List has not completed its first sync" }, origin);

  const { data: row } = await admin
    .from("zoho_hit_list_rows")
    .select("row_key")
    .eq("sync_id", latestSync.id)
    .eq("row_key", rowKey)
    .maybeSingle();
  if (!row) return json(404, { error: "This Hit List row no longer exists" }, origin);

  if (completed) {
    const { error } = await admin.from("hit_list_dismissals").upsert({
      row_key: rowKey,
      dismissed_at: new Date().toISOString(),
      dismissed_by: auth.user.id,
      dismissed_by_email: auth.member.email,
    });
    if (error) return json(502, { error: "The completed status could not be saved" }, origin);
  } else {
    const { error } = await admin.from("hit_list_dismissals").delete().eq("row_key", rowKey);
    if (error) return json(502, { error: "The completed status could not be removed" }, origin);
  }

  return json(200, { ok: true, rowKey, completed }, origin);
});
