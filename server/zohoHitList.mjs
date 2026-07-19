import { readFile } from "node:fs/promises";
import {
  buildHitList,
  clean,
  hitListCounts,
} from "../supabase/functions/_shared/hitList.mjs";
import { buildDealFacts } from "../supabase/functions/_shared/dealFacts.mjs";
import { fetchJsonWithRetry } from "../supabase/functions/_shared/fetchJson.mjs";

const DEFAULT_ACCOUNTS_DOMAIN = "https://accounts.zoho.eu";
const DEFAULT_API_DOMAIN = "https://www.zohoapis.eu";
const DEFAULT_CRM_ORG_SLUG = "wildvisionltd";
const DEFAULT_SCOPE = "ZohoCRM.modules.deals.READ";
export const HIT_LIST_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

let cachedSnapshot = null;
let inFlightRefresh = null;

function normaliseDomain(value, fallback) {
  return (clean(value) || fallback).replace(/\/$/, "");
}

function localCredential(content, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^\\s*${escapedLabel}\\s*:\\s*(.+?)\\s*$`, "im"));
  return clean(match?.[1]);
}

async function readLocalCredentialFile(localCredentialFile) {
  if (!localCredentialFile) return "";

  try {
    return await readFile(localCredentialFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function resolveConfig({ env, allowLocalCredentialFile, localCredentialFile }) {
  let localContent = "";

  if (allowLocalCredentialFile) {
    localContent = await readLocalCredentialFile(localCredentialFile);
  }

  const clientId = clean(env.ZOHO_CLIENT_ID)
    || localCredential(localContent, "self client ID")
    || localCredential(localContent, "Client Id");
  const clientSecret = clean(env.ZOHO_CLIENT_SECRET)
    || localCredential(localContent, "self client secret")
    || localCredential(localContent, "Client Secret");
  const orgId = clean(env.ZOHO_CRM_ORG_ID)
    || localCredential(localContent, "Zoho CRM Org ID");
  const refreshToken = clean(env.ZOHO_REFRESH_TOKEN);

  if (!clientId || !clientSecret || (!refreshToken && !orgId)) {
    const error = new Error("Zoho server credentials are not configured.");
    error.code = "ZOHO_CONFIG_MISSING";
    throw error;
  }

  return {
    clientId,
    clientSecret,
    orgId,
    orgSlug: clean(env.ZOHO_CRM_ORG_SLUG) || DEFAULT_CRM_ORG_SLUG,
    refreshToken,
    accountsDomain: normaliseDomain(env.ZOHO_ACCOUNTS_DOMAIN, DEFAULT_ACCOUNTS_DOMAIN),
    apiDomain: normaliseDomain(env.ZOHO_API_DOMAIN, DEFAULT_API_DOMAIN),
    scope: clean(env.ZOHO_READ_SCOPE) || DEFAULT_SCOPE,
  };
}

async function getAccessToken(config) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  if (config.refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", config.refreshToken);
  } else {
    body.set("grant_type", "client_credentials");
    body.set("scope", config.scope);
    body.set("soid", `ZohoCRM.${config.orgId}`);
  }

  const { response, payload } = await fetchJsonWithRetry(`${config.accountsDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok || !payload.access_token) {
    const error = new Error("Zoho authentication failed. Check the server-side Zoho connection.");
    error.code = "ZOHO_AUTH_FAILED";
    throw error;
  }

  return {
    accessToken: payload.access_token,
    apiDomain: normaliseDomain(payload.api_domain, config.apiDomain),
  };
}

async function fetchDeals({ accessToken, apiDomain }) {
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
  const deals = [];
  let page = 1;
  let pageToken = "";

  for (let requestNumber = 0; requestNumber < 100; requestNumber += 1) {
    const url = new URL(`${apiDomain}/crm/v8/Deals`);
    url.searchParams.set("fields", fields);
    url.searchParams.set("per_page", "200");

    if (pageToken) {
      url.searchParams.set("page_token", pageToken);
    } else {
      url.searchParams.set("page", String(page));
    }

    const { response, payload } = await fetchJsonWithRetry(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });

    if (!response.ok) {
      const error = new Error("Zoho could not return the Deals list.");
      error.code = "ZOHO_READ_FAILED";
      throw error;
    }

    deals.push(...(Array.isArray(payload.data) ? payload.data : []));

    if (!payload.info?.more_records) return deals;

    if (payload.info.next_page_token) {
      pageToken = payload.info.next_page_token;
    } else if (!pageToken && page < 10) {
      page += 1;
    } else {
      const error = new Error("Zoho pagination stopped before all Deals were read.");
      error.code = "ZOHO_PAGINATION_FAILED";
      throw error;
    }
  }

  const error = new Error("Zoho returned more Deal pages than expected.");
  error.code = "ZOHO_PAGINATION_FAILED";
  throw error;
}

function cacheAgeMs(entry) {
  const generatedAt = Date.parse(entry?.generatedAt || entry?.payload?.generatedAt || "");
  return Number.isNaN(generatedAt) ? Number.POSITIVE_INFINITY : Date.now() - generatedAt;
}

async function readCachedSnapshot(cache) {
  if (cache) return cache.readLatest();
  return cachedSnapshot;
}

async function writeCachedSnapshot(cache, payload) {
  cachedSnapshot = { generatedAt: payload.generatedAt, payload };
  if (cache) await cache.write(payload);
}

function publicHitListPayload(payload, stale) {
  const { dealFacts: _dealFacts, version: _version, ...hitList } = payload;
  return { ...hitList, stale };
}

export function filterDealFacts(dealFacts, { ownerEmail = "", team = false } = {}) {
  if (team) return dealFacts;
  const normalisedOwnerEmail = clean(ownerEmail).toLowerCase();
  if (!normalisedOwnerEmail) {
    const error = new Error("A Zoho owner email is required for personal sales data.");
    error.code = "ZOHO_OWNER_REQUIRED";
    throw error;
  }
  return dealFacts.filter((deal) => deal.Owner?.email === normalisedOwnerEmail);
}

async function refreshZohoSnapshot({ env, allowLocalCredentialFile, localCredentialFile, cache }) {
  const config = await resolveConfig({ env, allowLocalCredentialFile, localCredentialFile });
  const auth = await getAccessToken(config);
  const deals = await fetchDeals(auth);
  const rows = buildHitList(deals, { apiDomain: auth.apiDomain, orgSlug: config.orgSlug });
  const payload = {
    version: 2,
    source: "zoho-cache",
    readOnly: true,
    generatedAt: new Date().toISOString(),
    refreshIntervalMinutes: 10,
    counts: hitListCounts(rows, deals.length),
    rows,
    dealFacts: buildDealFacts(deals),
  };

  await writeCachedSnapshot(cache, payload);
  return payload;
}

async function getZohoSnapshot({
  env,
  allowLocalCredentialFile,
  localCredentialFile,
  forceRefresh,
  cache,
  cacheTtlMs,
  requireDealFacts = false,
}) {
  const cached = await readCachedSnapshot(cache);
  const cacheHasDealFacts = Array.isArray(cached?.payload?.dealFacts);
  const cachedAgeMs = cached ? cacheAgeMs(cached) : Number.POSITIVE_INFINITY;
  const cacheIsUsable = cached
    && (!requireDealFacts || cacheHasDealFacts)
    && cachedAgeMs < cacheTtlMs;
  const refreshAllowed = !cached || cachedAgeMs >= cacheTtlMs;

  if (cacheIsUsable && (!forceRefresh || !refreshAllowed)) {
    return { payload: cached.payload, stale: false };
  }

  if (!inFlightRefresh) {
    inFlightRefresh = refreshZohoSnapshot({
      env,
      allowLocalCredentialFile,
      localCredentialFile,
      cache,
    }).finally(() => {
      inFlightRefresh = null;
    });
  }

  try {
    return { payload: await inFlightRefresh, stale: false };
  } catch (error) {
    if (cached && (!requireDealFacts || cacheHasDealFacts)) {
      return { payload: cached.payload, stale: true };
    }
    throw error;
  }
}

export async function getZohoHitList({
  env = process.env,
  allowLocalCredentialFile = false,
  localCredentialFile = "",
  forceRefresh = false,
  cache = null,
  cacheTtlMs = HIT_LIST_REFRESH_INTERVAL_MS,
} = {}) {
  const snapshot = await getZohoSnapshot({
    env,
    allowLocalCredentialFile,
    localCredentialFile,
    forceRefresh,
    cache,
    cacheTtlMs,
  });
  return publicHitListPayload(snapshot.payload, snapshot.stale);
}

export async function getZohoSalesDeals({
  env = process.env,
  allowLocalCredentialFile = false,
  localCredentialFile = "",
  forceRefresh = false,
  cache = null,
  cacheTtlMs = HIT_LIST_REFRESH_INTERVAL_MS,
  ownerEmail = "",
  team = false,
} = {}) {
  const snapshot = await getZohoSnapshot({
    env,
    allowLocalCredentialFile,
    localCredentialFile,
    forceRefresh,
    cache,
    cacheTtlMs,
    requireDealFacts: true,
  });
  const deals = filterDealFacts(snapshot.payload.dealFacts, { ownerEmail, team });
  return {
    source: snapshot.payload.source,
    readOnly: true,
    generatedAt: snapshot.payload.generatedAt,
    refreshIntervalMinutes: snapshot.payload.refreshIntervalMinutes,
    stale: snapshot.stale,
    count: deals.length,
    deals,
  };
}

export { buildHitList };

export function publicZohoError(error) {
  if (error?.code === "ZOHO_CONFIG_MISSING") {
    return { status: 503, message: "Zoho is not configured on this server yet." };
  }
  if (error?.code === "ZOHO_AUTH_FAILED") {
    return { status: 502, message: "Zoho login failed. Check the server-side Zoho connection." };
  }
  if (error?.code === "ZOHO_OWNER_REQUIRED") {
    return { status: 400, message: error.message };
  }
  return { status: 502, message: "Zoho data could not be loaded. No CRM records were changed." };
}
