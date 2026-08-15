import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchJsonWithRetry } from "../_shared/fetchJson.mjs";
import {
  displayNameForMember,
  evaluateZohoSalesAccess,
  normalizeAccessValue,
  parseAccessList,
  planSalesOsMembership,
  validateGoogleAuthUser,
} from "../_shared/zohoSalesAccess.mjs";

const DEFAULT_ACCOUNTS_DOMAIN = "https://accounts.zoho.eu";
const DEFAULT_API_DOMAIN = "https://www.zohoapis.eu";
const DEFAULT_USER_SCOPE = "ZohoCRM.users.READ";
const MEMBER_FIELDS = "email,user_id,role,display_name,active,stats_enabled";

class AuthorizationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function env(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

function requiredEnv(name: string) {
  const value = env(name);
  if (!value) throw new AuthorizationError(503, "Sales OS access is not configured");
  return value;
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

function salesTeamAccess() {
  return {
    roleIds: parseAccessList(env("ZOHO_SALES_ROLE_IDS")),
    roleNames: parseAccessList(env("ZOHO_SALES_ROLE_NAMES")),
    profileIds: parseAccessList(env("ZOHO_SALES_PROFILE_IDS")),
    profileNames: parseAccessList(env("ZOHO_SALES_PROFILE_NAMES")),
  };
}

async function getZohoAccessToken() {
  const clientId = requiredEnv("ZOHO_CLIENT_ID");
  const clientSecret = requiredEnv("ZOHO_CLIENT_SECRET");
  const refreshToken = env("ZOHO_REFRESH_TOKEN");
  const orgId = env("ZOHO_CRM_ORG_ID");
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });

  if (refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
  } else if (orgId) {
    body.set("grant_type", "client_credentials");
    body.set("scope", env("ZOHO_SALES_ACCESS_SCOPE") || DEFAULT_USER_SCOPE);
    body.set("soid", `ZohoCRM.${orgId}`);
  } else {
    throw new AuthorizationError(503, "Zoho access is not configured");
  }

  const accountsDomain = (env("ZOHO_ACCOUNTS_DOMAIN") || DEFAULT_ACCOUNTS_DOMAIN).replace(/\/$/, "");
  const { response, payload } = await fetchJsonWithRetry(`${accountsDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok || !payload.access_token) {
    throw new AuthorizationError(502, "Zoho could not verify Sales OS access");
  }

  return {
    accessToken: String(payload.access_token),
    apiDomain: String(payload.api_domain || env("ZOHO_API_DOMAIN") || DEFAULT_API_DOMAIN).replace(/\/$/, ""),
  };
}

async function fetchAllZohoUsers({ accessToken, apiDomain }: { accessToken: string; apiDomain: string }) {
  const users: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= 100; page += 1) {
    const url = new URL(`${apiDomain}/crm/v8/users`);
    url.searchParams.set("type", "AllUsers");
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "200");
    const { response, payload } = await fetchJsonWithRetry(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    if (!response.ok || !Array.isArray(payload.users)) {
      throw new AuthorizationError(502, "Zoho could not verify Sales OS access");
    }
    users.push(...payload.users);
    if (!payload.info?.more_records) return users;
  }
  throw new AuthorizationError(502, "Zoho could not verify Sales OS access");
}

async function readMemberships(admin: ReturnType<typeof createClient>, userId: string, email: string) {
  const [byUserResult, byEmailResult] = await Promise.all([
    admin.from("sales_os_members").select(MEMBER_FIELDS).eq("user_id", userId).maybeSingle(),
    admin.from("sales_os_members").select(MEMBER_FIELDS).eq("email", email).maybeSingle(),
  ]);
  if (byUserResult.error || byEmailResult.error) {
    throw new AuthorizationError(503, "Sales OS membership could not be checked");
  }
  return { memberByUserId: byUserResult.data, memberByEmail: byEmailResult.data };
}

async function deactivateExactMember(admin: ReturnType<typeof createClient>, authUser: Record<string, unknown>, email: string) {
  const { memberByUserId, memberByEmail } = await readMemberships(admin, String(authUser.id), email);
  const member = memberByUserId || memberByEmail;
  if (!member || member.user_id !== authUser.id || normalizeAccessValue(member.email) !== email || member.active !== true) return;
  const { error } = await admin
    .from("sales_os_members")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("user_id", authUser.id)
    .eq("email", email);
  if (error) throw new AuthorizationError(503, "Sales OS membership could not be updated");
}

Deno.serve(async (request) => {
  const origin = allowedOrigin(request);
  if (origin === null) return json(403, { error: "Origin not allowed" });
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...responseHeaders(origin),
        "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }
  if (request.method !== "POST") return json(405, { error: "POST required" }, origin);

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return json(401, { error: "Authentication required" }, origin);
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const adminKey = env("SALES_OS_SUPABASE_SECRET_KEY") || requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(supabaseUrl, adminKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    const authUser = userData?.user;
    const auth = validateGoogleAuthUser(authUser);
    if (userError || !auth.allowed) {
      return json(userError || auth.code === "INVALID_SESSION" ? 401 : 403, {
        error: "A verified Wild Vision Google account is required",
      }, origin);
    }

    const zohoCredential = await getZohoAccessToken();
    const zohoUsers = await fetchAllZohoUsers(zohoCredential);
    const zohoAccess = evaluateZohoSalesAccess({ authUser, zohoUsers, access: salesTeamAccess() });
    if (zohoAccess.code === "SALES_TEAM_NOT_CONFIGURED") {
      throw new AuthorizationError(503, "Sales team access is not configured");
    }
    if (!zohoAccess.allowed) {
      await deactivateExactMember(admin, authUser, auth.email);
      return json(403, { error: "This account is not eligible for Sales OS" }, origin);
    }

    const memberships = await readMemberships(admin, authUser.id, auth.email);
    const plan = planSalesOsMembership({ authUser, email: auth.email, ...memberships });
    if (!plan.allowed) {
      return json(403, { error: "This account is not eligible for Sales OS" }, origin);
    }
    if (plan.action === "keep") {
      return json(200, { authorized: true, member: plan.member }, origin);
    }

    const newMember = {
      ...plan.member,
      display_name: displayNameForMember(zohoAccess.zohoUser, authUser, auth.email),
      updated_at: new Date().toISOString(),
    };
    let { data: member, error: insertError } = await admin
      .from("sales_os_members")
      .insert(newMember)
      .select(MEMBER_FIELDS)
      .single();

    if (insertError) {
      const retried = await readMemberships(admin, authUser.id, auth.email);
      const retryPlan = planSalesOsMembership({ authUser, email: auth.email, ...retried });
      if (!retryPlan.allowed || retryPlan.action !== "keep") {
        throw new AuthorizationError(503, "Sales OS membership could not be created");
      }
      member = retryPlan.member;
    }

    return json(200, { authorized: true, member }, origin);
  } catch (error) {
    if (error instanceof AuthorizationError) return json(error.status, { error: error.message }, origin);
    return json(503, { error: "Sales OS access could not be verified" }, origin);
  }
});
