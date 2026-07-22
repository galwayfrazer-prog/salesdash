import { createClient } from "npm:@supabase/supabase-js@2";
import { buildHitList, hitListCounts } from "../_shared/hitList.mjs";
import { buildDealFacts } from "../_shared/dealFacts.mjs";
import {
  buildCrmHygieneRows,
  crmHygieneCounts,
} from "../_shared/crmHygiene.mjs";
import { buildTeamSalesSummary } from "../_shared/teamSalesSummary.mjs";
import { fetchJsonWithRetry } from "../_shared/fetchJson.mjs";

const DEFAULT_ACCOUNTS_DOMAIN = "https://accounts.zoho.eu";
const DEFAULT_API_DOMAIN = "https://www.zohoapis.eu";
const DEFAULT_CRM_ORG_SLUG = "wildvisionltd";
const DEFAULT_SCOPE = "ZohoCRM.modules.deals.READ";

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new SyncError("CONFIG_MISSING", `Missing ${name}`);
  return value;
}

function optionalEnv(name: string, fallback = "") {
  return Deno.env.get(name)?.trim() || fallback;
}

class SyncError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function getZohoAccessToken() {
  const clientId = requiredEnv("ZOHO_CLIENT_ID");
  const clientSecret = requiredEnv("ZOHO_CLIENT_SECRET");
  const refreshToken = optionalEnv("ZOHO_REFRESH_TOKEN");
  const orgId = optionalEnv("ZOHO_CRM_ORG_ID");
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });

  if (refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
  } else if (orgId) {
    body.set("grant_type", "client_credentials");
    body.set("scope", optionalEnv("ZOHO_READ_SCOPE", DEFAULT_SCOPE));
    body.set("soid", `ZohoCRM.${orgId}`);
  } else {
    throw new SyncError("CONFIG_MISSING", "A Zoho refresh token or CRM organization ID is required.");
  }

  const accountsDomain = optionalEnv("ZOHO_ACCOUNTS_DOMAIN", DEFAULT_ACCOUNTS_DOMAIN)
    .replace(/\/$/, "");
  const { response, payload } = await fetchJsonWithRetry(`${accountsDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok || !payload.access_token) {
    throw new SyncError("ZOHO_AUTH_FAILED", "Zoho authentication failed.");
  }

  return {
    accessToken: String(payload.access_token),
    apiDomain: String(payload.api_domain || optionalEnv("ZOHO_API_DOMAIN", DEFAULT_API_DOMAIN))
      .replace(/\/$/, ""),
  };
}

async function fetchAllDeals({ accessToken, apiDomain }: { accessToken: string; apiDomain: string }) {
  const fields = [
    "Deal_Name",
    "Creator",
    "Associated_Platform",
    "Stage",
    "Owner",
    "Last_Activity_Time",
    "WV_Percentage",
    "Closing_Date",
    "Created_Time",
    "Modified_Time",
    "Pipeline",
    "Layout",
  ].join(",");
  const deals: Array<Record<string, unknown>> = [];
  let page = 1;
  let pageToken = "";

  for (let requestNumber = 0; requestNumber < 100; requestNumber += 1) {
    const url = new URL(`${apiDomain}/crm/v8/Deals`);
    url.searchParams.set("fields", fields);
    url.searchParams.set("per_page", "200");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    else url.searchParams.set("page", String(page));

    const { response, payload } = await fetchJsonWithRetry(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });

    if (!response.ok) throw new SyncError("ZOHO_READ_FAILED", "Zoho Deals could not be read.");
    if (Array.isArray(payload.data)) deals.push(...payload.data);
    if (!payload.info?.more_records) return deals;

    if (payload.info.next_page_token) pageToken = String(payload.info.next_page_token);
    else if (!pageToken && page < 10) page += 1;
    else throw new SyncError("ZOHO_PAGINATION_FAILED", "Zoho pagination stopped early.");
  }

  throw new SyncError("ZOHO_PAGINATION_FAILED", "Zoho returned too many Deal pages.");
}

async function insertInBatches(
  supabase: ReturnType<typeof createClient>,
  table: string,
  rows: Array<Record<string, unknown>>,
  batchSize = 500,
) {
  for (let index = 0; index < rows.length; index += batchSize) {
    const { error } = await supabase.from(table).insert(rows.slice(index, index + batchSize));
    if (error) throw new SyncError("CACHE_WRITE_FAILED", `Could not save ${table}.`);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "POST required" });

  const expectedSecret = optionalEnv("HIT_LIST_SYNC_SECRET");
  if (!expectedSecret || request.headers.get("Authorization") !== `Bearer ${expectedSecret}`) {
    return json(401, { error: "Unauthorized" });
  }

  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const adminKey = optionalEnv("SALES_OS_SUPABASE_SECRET_KEY")
    || requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const syncId = crypto.randomUUID();
  let syncCreated = false;

  try {
    const staleRunningBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    await supabase
      .from("zoho_hit_list_syncs")
      .delete()
      .eq("status", "running")
      .lt("started_at", staleRunningBefore);

    const { error: startError } = await supabase.from("zoho_hit_list_syncs").insert({
      id: syncId,
      status: "running",
      source: "zoho",
    });
    if (startError?.code === "23505") {
      return json(409, { ok: false, error: "SYNC_ALREADY_RUNNING" });
    }
    if (startError) throw new SyncError("CACHE_WRITE_FAILED", "Could not start cache snapshot.");
    syncCreated = true;

    const auth = await getZohoAccessToken();
    const deals = await fetchAllDeals(auth);
    const rows = buildHitList(deals, {
      apiDomain: auth.apiDomain,
      orgSlug: optionalEnv("ZOHO_CRM_ORG_SLUG", DEFAULT_CRM_ORG_SLUG),
    });
    const dealFacts = buildDealFacts(deals);
    const crmHygieneRows = buildCrmHygieneRows(dealFacts, {
      apiDomain: auth.apiDomain,
      orgSlug: optionalEnv("ZOHO_CRM_ORG_SLUG", DEFAULT_CRM_ORG_SLUG),
    });
    const teamSalesSummary = buildTeamSalesSummary(dealFacts);
    const counts = hitListCounts(rows, deals.length);
    const generatedAt = new Date().toISOString();

    if (rows.length > 0) {
      const databaseRows = rows.map((row) => ({
        sync_id: syncId,
        row_key: row.id,
        creator_name: row.creator,
        live_platform: row.livePlatform,
        missing_platform: row.missingPlatform,
        owner_name: row.owner,
        last_activity_at: row.lastActivityAt || null,
        deal_id: row.dealId,
        zoho_record_url: row.zohoRecordUrl,
      }));
      await insertInBatches(supabase, "zoho_hit_list_rows", databaseRows);
    }

    if (dealFacts.length > 0) {
      const databaseFacts = dealFacts.map((deal) => ({
        sync_id: syncId,
        deal_id: deal.id,
        deal_name: deal.Deal_Name,
        stage: deal.Stage,
        creator_id: deal.Creator.id,
        creator_name: deal.Creator.name,
        associated_platform: deal.Associated_Platform.name,
        wv_percentage: deal.WV_Percentage,
        closing_date: deal.Closing_Date || null,
        created_time: deal.Created_Time || null,
        modified_time: deal.Modified_Time || null,
        last_activity_at: deal.Last_Activity_Time || null,
        owner_id: deal.Owner.id,
        owner_name: deal.Owner.name,
        owner_email: deal.Owner.email,
        pipeline: deal.Pipeline,
        layout_id: deal.Layout.id,
        layout_name: deal.Layout.name,
      }));
      await insertInBatches(supabase, "zoho_deal_facts", databaseFacts);
    }

    if (crmHygieneRows.length > 0) {
      const databaseHygieneRows = crmHygieneRows.map((row) => ({
        sync_id: syncId,
        row_key: row.id,
        deal_id: row.dealId,
        deal_name: row.dealName,
        creator_name: row.creator,
        platform: row.platform,
        stage: row.stage,
        owner_name: row.owner,
        owner_email: row.ownerEmail,
        last_activity_at: row.lastActivityAt || null,
        days_inactive: row.daysInactive,
        inactive_7_days: row.inactive7Days,
        neglected_90_days: row.neglected90Days,
        missing_fields: row.missingFields,
        zoho_record_url: row.zohoRecordUrl,
      }));
      await insertInBatches(supabase, "zoho_crm_hygiene_rows", databaseHygieneRows);
    }

    const { error: finishError } = await supabase
      .from("zoho_hit_list_syncs")
      .update({
        status: "completed",
        completed_at: generatedAt,
        generated_at: generatedAt,
        deals_scanned: counts.dealsScanned,
        opportunities: counts.opportunities,
        missing_spotify: counts.missingSpotify,
        missing_microsoft_start: counts.missingMicrosoftStart,
        team_sales_summary: teamSalesSummary,
        error_code: null,
      })
      .eq("id", syncId);
    if (finishError) throw new SyncError("CACHE_WRITE_FAILED", "Could not complete cache snapshot.");

    const { data: oldSyncs } = await supabase
      .from("zoho_hit_list_syncs")
      .select("id")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .range(12, 99);
    if (oldSyncs?.length) {
      await supabase.from("zoho_hit_list_syncs").delete().in("id", oldSyncs.map(({ id }) => id));
    }

    const abandonedBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("zoho_hit_list_syncs")
      .delete()
      .in("status", ["running", "failed"])
      .lt("started_at", abandonedBefore);

    return json(200, {
      ok: true,
      generatedAt,
      counts,
      crmHygieneCounts: crmHygieneCounts(crmHygieneRows),
    });
  } catch (error) {
    const errorCode = error instanceof SyncError ? error.code : "SYNC_FAILED";
    if (syncCreated) {
      await supabase
        .from("zoho_hit_list_syncs")
        .update({ status: "failed", completed_at: new Date().toISOString(), error_code: errorCode })
        .eq("id", syncId);

      const abandonedBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await supabase
        .from("zoho_hit_list_syncs")
        .delete()
        .in("status", ["running", "failed"])
        .lt("started_at", abandonedBefore);
    }
    console.error(`[sync-zoho-hit-list] ${errorCode}`);
    return json(500, { ok: false, error: errorCode });
  }
});
