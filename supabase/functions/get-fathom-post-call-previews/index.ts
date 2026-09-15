import { createClient } from "npm:@supabase/supabase-js@2";
import {
  requireSalesOsMember,
  SalesOsAuthError,
} from "../_shared/salesOsAuth.mjs";

const ALLOWED_STATUSES = new Set([
  "received",
  "processing",
  "ready_for_review",
  "no_external_attendees",
  "no_match",
  "partial_match",
  "ambiguous",
  "schema_configuration_required",
  "failed",
]);

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

function canReview(member: Record<string, unknown>) {
  if (member.role === "manager") return true;
  const approved = new Set(env("FATHOM_PREVIEW_REVIEWER_EMAILS")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[^@\s]+@wildvision\.io$/.test(value)));
  return approved.has(String(member.email || "").toLowerCase());
}

function validEventId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
    const { member } = await requireSalesOsMember({ userClient, admin });
    if (!canReview(member)) return json(403, { error: "Preview reviewer access required" }, origin);
  } catch (error) {
    if (error instanceof SalesOsAuthError) return json(error.status, { error: error.message }, origin);
    return json(503, { error: "Membership could not be checked" }, origin);
  }

  const url = new URL(request.url);
  const eventId = (url.searchParams.get("eventId") || "").trim();
  const status = (url.searchParams.get("status") || "").trim();
  if (eventId && !validEventId(eventId)) return json(400, { error: "Invalid eventId" }, origin);
  if (status && !ALLOWED_STATUSES.has(status)) return json(400, { error: "Invalid status" }, origin);
  const requestedLimit = Number(url.searchParams.get("limit") || "20");
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;

  const eventFields = [
    "id",
    "recording_id",
    "meeting_title",
    "meeting_url",
    "share_url",
    "scheduled_start_at",
    "recorded_by_name",
    "summary_preview",
    "action_items",
    "proposed_note",
    "status",
    "reason_code",
    "schema_snapshot",
    "attendee_count",
    "candidate_count",
    "error_code",
    "received_at",
    "processed_at",
    "updated_at",
  ].join(",");
  let query = admin.from("fathom_post_call_events")
    .select(eventFields)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (eventId) query = query.eq("id", eventId);
  if (status) query = query.eq("status", status);
  const { data: events, error: eventError } = await query;
  if (eventError) return json(503, { error: "Previews could not be read" }, origin);
  const eventIds = (events || []).map((event) => event.id);
  if (eventId && eventIds.length === 0) return json(404, { error: "Preview not found" }, origin);

  let attendees: Array<Record<string, unknown>> = [];
  let candidates: Array<Record<string, unknown>> = [];
  if (eventIds.length > 0) {
    const [attendeeResult, candidateResult] = await Promise.all([
      admin.from("fathom_post_call_attendees")
        .select("event_id,normalized_email,display_name,email_domain,source_labels,fathom_marked_external,shared_mailbox,resolution_status,reason_code")
        .in("event_id", eventIds)
        .order("normalized_email", { ascending: true }),
      admin.from("fathom_post_call_candidates")
        .select("event_id,attendee_email,contact_id,contact_name,creator_id,creator_name,deal_id,deal_name,deal_stage,platform,owner_name,eligible,reason_code,evidence")
        .in("event_id", eventIds)
        .order("attendee_email", { ascending: true }),
    ]);
    if (attendeeResult.error || candidateResult.error) {
      return json(503, { error: "Preview evidence could not be read" }, origin);
    }
    attendees = attendeeResult.data || [];
    candidates = candidateResult.data || [];
  }

  const previews = (events || []).map((event) => ({
    ...event,
    attendees: attendees.filter((attendee) => attendee.event_id === event.id)
      .map(({ event_id: _eventId, ...attendee }) => attendee),
    candidates: candidates.filter((candidate) => candidate.event_id === event.id)
      .map(({ event_id: _eventId, ...candidate }) => candidate),
  }));
  return json(200, {
    mode: "preview",
    readOnly: true,
    count: previews.length,
    previews,
  }, origin);
});
