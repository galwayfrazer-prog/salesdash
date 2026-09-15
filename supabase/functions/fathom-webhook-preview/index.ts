import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assertReadOnlyZohoRequest,
  buildPreviewNote,
  cleanPreviewText,
  dealPreview,
  exactContactMatches,
  extractExternalAttendees,
  lookupRecords,
  normalizeEmail,
  parseInternalDomains,
  resolvePreviewStatus,
  validFathomInviteeEnvelope,
  verifyFathomSignature,
} from "../_shared/fathomPostCallPreview.mjs";

const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_ACCOUNTS_DOMAIN = "https://accounts.zoho.eu";
const DEFAULT_API_DOMAIN = "https://www.zohoapis.eu";

type JsonObject = Record<string, any>;

class PreviewError extends Error {
  code: string;
  status: number;

  constructor(code: string, status = 500) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function json(status: number, body: JsonObject) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function env(name: string, fallback = "") {
  return Deno.env.get(name)?.trim() || fallback;
}

function requiredEnv(name: string) {
  const value = env(name);
  if (!value) throw new PreviewError(`CONFIG_MISSING_${name}`);
  return value;
}

async function validFathomSignature(request: Request, rawBody: string, secret: string) {
  return verifyFathomSignature({
    webhookId: request.headers.get("webhook-id"),
    timestampText: request.headers.get("webhook-timestamp"),
    signatureHeader: request.headers.get("webhook-signature"),
    rawBody,
    secret,
  });
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeUrl(value: unknown) {
  const text = cleanPreviewText(value, 2_000);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function safeDate(value: unknown) {
  const text = cleanPreviewText(value, 100);
  if (!text || Number.isNaN(Date.parse(text))) return null;
  return new Date(text).toISOString();
}

function sanitizeActionItems(payload: JsonObject) {
  return (Array.isArray(payload.action_items) ? payload.action_items : [])
    .slice(0, 50)
    .map((action) => ({
      description: cleanPreviewText(action?.description, 1_000),
      completed: action?.completed === true,
      assigneeName: cleanPreviewText(action?.assignee?.name, 200),
      assigneeEmail: normalizeEmail(action?.assignee?.email),
    }))
    .filter((action) => action.description);
}

async function fetchJson(url: string, init: RequestInit = {}) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, redirect: "error" });
      const text = await response.text();
      let payload: JsonObject = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = {};
        }
      }
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
        return { response, payload };
      }
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw lastError || new Error("REQUEST_FAILED");
}

async function getZohoAccessToken() {
  if (env("ZOHO_WRITE_MODE", "disabled").toLowerCase() !== "disabled") {
    throw new PreviewError("ZOHO_WRITE_MODE_MUST_BE_DISABLED");
  }
  const clientId = requiredEnv("ZOHO_PREVIEW_CLIENT_ID");
  const clientSecret = requiredEnv("ZOHO_PREVIEW_CLIENT_SECRET");
  const refreshToken = env("ZOHO_PREVIEW_REFRESH_TOKEN");
  const orgId = env("ZOHO_PREVIEW_CRM_ORG_ID") || env("ZOHO_CRM_ORG_ID");
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });

  if (refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
  } else if (orgId) {
    body.set("grant_type", "client_credentials");
    body.set("scope", requiredEnv("ZOHO_PREVIEW_READ_SCOPE"));
    body.set("soid", `ZohoCRM.${orgId}`);
  } else {
    throw new PreviewError("ZOHO_CONFIG_MISSING");
  }

  const accountsDomain = env("ZOHO_ACCOUNTS_DOMAIN", DEFAULT_ACCOUNTS_DOMAIN).replace(/\/$/, "");
  const { response, payload } = await fetchJson(`${accountsDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new PreviewError("ZOHO_AUTH_FAILED");
  }
  const apiDomain = new URL(
    String(payload.api_domain || env("ZOHO_API_DOMAIN", DEFAULT_API_DOMAIN)).replace(/\/$/, ""),
  ).origin;
  const expectedApiOrigin = new URL(env("ZOHO_API_DOMAIN", DEFAULT_API_DOMAIN)).origin;
  if (new URL(apiDomain).origin !== expectedApiOrigin) {
    throw new PreviewError("ZOHO_API_ORIGIN_MISMATCH");
  }
  return {
    accessToken: payload.access_token,
    apiDomain,
  };
}

async function zohoRead(apiDomain: string, accessToken: string, path: string) {
  assertReadOnlyZohoRequest("GET", path);
  const { response, payload } = await fetchJson(`${apiDomain}${path}`, {
    method: "GET",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  if (response.status === 204) return {};
  if (!response.ok) throw new PreviewError(`ZOHO_READ_FAILED_${response.status}`);
  return payload;
}

function rows(payload: JsonObject, key: string) {
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}

async function discoverZohoSchema(apiDomain: string, accessToken: string) {
  const modulesPayload = await zohoRead(apiDomain, accessToken, "/crm/v8/settings/modules");
  let pinned: JsonObject | null = null;
  const pinnedText = env("ZOHO_PREVIEW_SCHEMA_JSON");
  if (pinnedText) {
    try {
      pinned = JSON.parse(pinnedText);
    } catch {
      throw new PreviewError("ZOHO_PREVIEW_SCHEMA_JSON_INVALID");
    }
  }
  const configuredModule = cleanPreviewText(pinned?.creators?.apiName, 200);
  const creatorModules = rows(modulesPayload, "modules").filter((module) => {
    if (configuredModule) return module?.api_name === configuredModule;
    const labels = [module?.module_name, module?.singular_label, module?.plural_label]
      .map((value) => cleanPreviewText(value, 200).toLowerCase());
    return labels.includes("creator") || labels.includes("creators");
  });
  const modules = rows(modulesPayload, "modules");
  const contactsModule = modules.find((module) => module?.api_name === "Contacts");
  const dealsModule = modules.find((module) => module?.api_name === "Deals");
  if (!contactsModule?.id || !dealsModule?.id) throw new PreviewError("STANDARD_MODULE_METADATA_MISSING");
  if (pinned && (creatorModules.length !== 1 || !creatorModules[0]?.api_name)) {
    throw new PreviewError("ZOHO_SCHEMA_DRIFT_CREATOR_MODULE");
  }
  const creatorModuleApiName = creatorModules.length === 1 ? creatorModules[0].api_name : "";

  const baseMetadata = await Promise.all([
    zohoRead(apiDomain, accessToken, "/crm/v8/settings/fields?module=Contacts"),
    zohoRead(apiDomain, accessToken, "/crm/v8/settings/layouts?module=Contacts"),
    zohoRead(apiDomain, accessToken, "/crm/v8/settings/fields?module=Deals"),
  ]);
  const creatorMetadata = creatorModuleApiName
    ? await Promise.all([
      zohoRead(apiDomain, accessToken, `/crm/v8/settings/fields?module=${encodeURIComponent(creatorModuleApiName)}`),
      zohoRead(apiDomain, accessToken, `/crm/v8/settings/layouts?module=${encodeURIComponent(creatorModuleApiName)}`),
    ])
    : [{}, {}];

  const contactFields = rows(baseMetadata[0], "fields");
  const contactLayouts = rows(baseMetadata[1], "layouts").filter((layout) => layout?.id);
  const dealFields = rows(baseMetadata[2], "fields");
  const creatorFields = rows(creatorMetadata[0], "fields");
  const creatorLayouts = rows(creatorMetadata[1], "layouts").filter((layout) => layout?.id);
  const readRelationsByLayout = async (moduleApiName: string, layouts: JsonObject[]) => {
    const payloads = await Promise.all(layouts.map((layout) => {
      const parameters = new URLSearchParams({ module: moduleApiName, layout_id: String(layout.id) });
      return zohoRead(apiDomain, accessToken, `/crm/v8/settings/related_lists?${parameters}`);
    }));
    return payloads.flatMap((payload, index) => rows(payload, "related_lists").map((related) => ({
      ...related,
      layout_id: String(layouts[index].id),
      layout_name: cleanPreviewText(layouts[index]?.name || layouts[index]?.display_label, 300),
    })));
  };
  const [contactRelations, creatorRelations] = await Promise.all([
    readRelationsByLayout("Contacts", contactLayouts),
    creatorModuleApiName ? readRelationsByLayout(creatorModuleApiName, creatorLayouts) : Promise.resolve([]),
  ]);
  const emailFieldCandidates = contactFields.filter((field) => field?.data_type === "email" && field?.api_name);
  const creatorNameFieldCandidates = creatorFields.filter((field) =>
    field?.data_type === "text" && field?.api_name
  );
  const contactLayoutField = contactFields.find((field) => field?.api_name === "Layout");
  const creatorLayoutField = creatorFields.find((field) => field?.api_name === "Layout");
  const contactCreatorLookupCandidates = contactFields.filter((field) =>
    field?.data_type === "lookup" && field?.lookup?.module?.api_name === creatorModuleApiName
  );
  const contactCreatorRelatedCandidates = contactRelations.filter((related) =>
    related?.module?.api_name === creatorModuleApiName
  );
  const creatorDealsRelatedCandidates = creatorRelations.filter((related) =>
    related?.module?.api_name === "Deals"
  );
  const dealCreatorLookupCandidates = dealFields.filter((field) =>
    field?.data_type === "lookup" && field?.lookup?.module?.api_name === creatorModuleApiName
  );
  const dealStageCandidates = dealFields.filter((field) => field?.api_name === "Stage");

  const reference = (item: JsonObject) => ({
    id: cleanPreviewText(String(item?.id || ""), 100),
    apiName: cleanPreviewText(item?.api_name, 200),
    label: cleanPreviewText(item?.field_label || item?.display_label || item?.singular_label, 300),
    href: cleanPreviewText(item?.href, 1_000),
    status: cleanPreviewText(item?.status, 100),
    targetModuleId: cleanPreviewText(String(item?.lookup?.module?.id || item?.module?.id || ""), 100),
    targetModuleApiName: cleanPreviewText(item?.lookup?.module?.api_name || item?.module?.api_name, 200),
    layoutId: cleanPreviewText(String(item?.layout_id || ""), 100),
    layoutName: cleanPreviewText(item?.layout_name, 300),
  });
  const snapshot = {
    apiOrigin: apiDomain,
    contacts: { id: String(contactsModule.id), apiName: "Contacts" },
    deals: { id: String(dealsModule.id), apiName: "Deals" },
    creatorModuleCandidates: creatorModules.map(reference),
    contactLayouts: contactLayouts.map((layout) => ({
      id: cleanPreviewText(String(layout.id), 100),
      name: cleanPreviewText(layout?.name || layout?.display_label, 300),
      status: cleanPreviewText(layout?.status, 100),
    })),
    creatorLayouts: creatorLayouts.map((layout) => ({
      id: cleanPreviewText(String(layout.id), 100),
      name: cleanPreviewText(layout?.name || layout?.display_label, 300),
      status: cleanPreviewText(layout?.status, 100),
    })),
    contactEmailFieldCandidates: emailFieldCandidates.map(reference),
    creatorNameFieldCandidates: creatorNameFieldCandidates.map(reference),
    contactCreatorLookupCandidates: contactCreatorLookupCandidates.map(reference),
    contactCreatorRelatedListCandidates: contactCreatorRelatedCandidates.map(reference),
    creatorDealsRelatedListCandidates: creatorDealsRelatedCandidates.map(reference),
    dealCreatorLookupCandidates: dealCreatorLookupCandidates.map(reference),
    dealStageFieldCandidates: dealStageCandidates.map((field) => ({
      ...reference(field),
      pickListValues: rows(field, "pick_list_values").map((value) =>
        cleanPreviewText(value?.actual_value || value?.display_value, 200)
      ).filter(Boolean),
    })),
  };

  if (!pinned) return { configured: false, snapshot };
  if (pinned.version !== 1 || cleanPreviewText(pinned.apiOrigin, 500).replace(/\/$/, "") !== apiDomain) {
    throw new PreviewError("ZOHO_SCHEMA_DRIFT_ORIGIN_OR_VERSION");
  }

  const exactRef = (items: JsonObject[], expected: JsonObject, code: string) => {
    const id = cleanPreviewText(String(expected?.id || ""), 100);
    const apiName = cleanPreviewText(expected?.apiName, 200);
    const match = items.find((item) => String(item?.id || "") === id && item?.api_name === apiName);
    if (!match) throw new PreviewError(code);
    return match;
  };
  const exactVisibleRelatedRef = (items: JsonObject[], expected: JsonObject, code: string) => {
    const id = cleanPreviewText(String(expected?.id || ""), 100);
    const apiName = cleanPreviewText(expected?.apiName, 200);
    const href = cleanPreviewText(expected?.href, 1_000);
    const match = items.find((item) =>
      String(item?.id || "") === id
      && item?.api_name === apiName
      && item?.status === "visible"
      && cleanPreviewText(item?.href, 1_000) === href
    );
    if (!match) throw new PreviewError(code);
    return match;
  };
  if (String(pinned?.contacts?.moduleId || "") !== String(contactsModule.id) || pinned?.contacts?.apiName !== "Contacts") {
    throw new PreviewError("ZOHO_SCHEMA_DRIFT_CONTACTS_MODULE");
  }
  if (String(pinned?.deals?.moduleId || "") !== String(dealsModule.id) || pinned?.deals?.apiName !== "Deals") {
    throw new PreviewError("ZOHO_SCHEMA_DRIFT_DEALS_MODULE");
  }
  if (String(pinned?.creators?.moduleId || "") !== String(creatorModules[0].id)) {
    throw new PreviewError("ZOHO_SCHEMA_DRIFT_CREATOR_MODULE");
  }
  const pinnedEmailFields = Array.isArray(pinned?.contacts?.emailFields) ? pinned.contacts.emailFields : [];
  if (pinnedEmailFields.length === 0) throw new PreviewError("ZOHO_SCHEMA_EMAIL_FIELDS_MISSING");
  const emailFields = pinnedEmailFields.map((field: JsonObject) => {
    const match = exactRef(emailFieldCandidates, field, "ZOHO_SCHEMA_DRIFT_EMAIL_FIELD");
    if (match.data_type !== "email") throw new PreviewError("ZOHO_SCHEMA_DRIFT_EMAIL_FIELD");
    return match.api_name;
  });
  const creatorNameField = exactRef(
    creatorNameFieldCandidates,
    pinned?.creators?.nameField,
    "ZOHO_SCHEMA_DRIFT_CREATOR_NAME_FIELD",
  );
  const dealStageField = exactRef(
    dealStageCandidates,
    pinned?.deals?.stageField,
    "ZOHO_SCHEMA_DRIFT_DEAL_STAGE_FIELD",
  );
  const activeStages = Array.isArray(pinned?.activeStages)
    ? pinned.activeStages.map((value: unknown) => cleanPreviewText(value, 200)).filter(Boolean)
    : [];
  if (activeStages.length === 0) throw new PreviewError("ZOHO_SCHEMA_ACTIVE_STAGES_MISSING");
  const knownStages = new Set(rows(dealStageField, "pick_list_values").map((value) =>
    cleanPreviewText(value?.actual_value || value?.display_value, 200)
  ));
  if (activeStages.some((stage: string) => !knownStages.has(stage))) {
    throw new PreviewError("ZOHO_SCHEMA_DRIFT_ACTIVE_STAGE");
  }

  const contactRelation = pinned?.contactCreatorRelation || {};
  let contactCreatorPath: JsonObject;
  if (contactRelation.mode === "lookup") {
    const match = exactRef(contactCreatorLookupCandidates, contactRelation, "ZOHO_SCHEMA_DRIFT_CONTACT_CREATOR_LOOKUP");
    if (String(match?.lookup?.module?.id || "") !== String(creatorModules[0].id)) {
      throw new PreviewError("ZOHO_SCHEMA_DRIFT_CONTACT_CREATOR_LOOKUP");
    }
    contactCreatorPath = { mode: "lookup", apiName: match.api_name, id: String(match.id) };
  } else if (contactRelation.mode === "related_list") {
    const match = exactVisibleRelatedRef(
      contactCreatorRelatedCandidates,
      contactRelation,
      "ZOHO_SCHEMA_DRIFT_CONTACT_CREATOR_RELATED_LIST",
    );
    if (
      String(match?.module?.id || "") !== String(creatorModules[0].id)
    ) {
      throw new PreviewError("ZOHO_SCHEMA_DRIFT_CONTACT_CREATOR_RELATED_LIST");
    }
    if (!contactLayoutField?.api_name) throw new PreviewError("ZOHO_SCHEMA_CONTACT_LAYOUT_FIELD_MISSING");
    contactCreatorPath = {
      mode: "related_list",
      apiName: match.api_name,
      id: String(match.id),
      href: match.href,
      targetModuleId: String(creatorModules[0].id),
    };
  } else {
    throw new PreviewError("ZOHO_SCHEMA_CONTACT_CREATOR_MODE_INVALID");
  }

  const dealCreatorField = exactRef(
    dealCreatorLookupCandidates,
    pinned?.deals?.creatorField,
    "ZOHO_SCHEMA_DRIFT_DEAL_CREATOR_FIELD",
  );
  if (String(dealCreatorField?.lookup?.module?.id || "") !== String(creatorModules[0].id)) {
    throw new PreviewError("ZOHO_SCHEMA_DRIFT_DEAL_CREATOR_FIELD");
  }

  const dealsRelation = pinned?.creatorDealsRelation || {};
  let creatorDealsPath: JsonObject;
  if (dealsRelation.mode === "related_list") {
    const match = exactVisibleRelatedRef(
      creatorDealsRelatedCandidates,
      dealsRelation,
      "ZOHO_SCHEMA_DRIFT_CREATOR_DEALS_RELATED_LIST",
    );
    if (
      String(match?.module?.id || "") !== String(dealsModule.id)
    ) {
      throw new PreviewError("ZOHO_SCHEMA_DRIFT_CREATOR_DEALS_RELATED_LIST");
    }
    if (!creatorLayoutField?.api_name) throw new PreviewError("ZOHO_SCHEMA_CREATOR_LAYOUT_FIELD_MISSING");
    creatorDealsPath = {
      mode: "related_list",
      apiName: match.api_name,
      id: String(match.id),
      href: match.href,
      targetModuleId: String(dealsModule.id),
    };
  } else if (dealsRelation.mode === "deal_lookup") {
    creatorDealsPath = { mode: "deal_lookup", apiName: dealCreatorField.api_name, id: String(dealCreatorField.id) };
  } else {
    throw new PreviewError("ZOHO_SCHEMA_CREATOR_DEALS_MODE_INVALID");
  }

  return {
    configured: true,
    snapshot,
    creatorModuleApiName,
    creatorNameField: creatorNameField.api_name,
    emailFields,
    contactNameFields: contactFields
      .map((field) => field?.api_name)
      .filter((apiName) => ["Full_Name", "First_Name", "Last_Name"].includes(apiName)),
    contactCreatorPath,
    creatorDealsPath,
    dealCreatorField: dealCreatorField.api_name,
    contactLayoutField: contactLayoutField?.api_name || "",
    creatorLayoutField: creatorLayoutField?.api_name || "",
    activeStages,
  };
}

function pathFromHref(href: string, recordId: string, fallbackModule: string, fallbackRelated: string) {
  const replaced = String(href || "")
    .replace("{ENTITYID}", encodeURIComponent(recordId))
    .replace(/^https:\/\/[^/]+\/crm\/v8\//i, "");
  const relative = replaced.replace(/^\/?crm\/v8\//i, "").replace(/^\//, "");
  const safeRelative = relative || `${encodeURIComponent(fallbackModule)}/${encodeURIComponent(recordId)}/${encodeURIComponent(fallbackRelated)}`;
  if (safeRelative.includes("..") || !safeRelative.startsWith(`${encodeURIComponent(fallbackModule)}/`)) {
    throw new PreviewError("ZOHO_RELATED_PATH_INVALID");
  }
  return `/crm/v8/${safeRelative}`;
}

async function fetchRelatedRecords(
  apiDomain: string,
  accessToken: string,
  { href, moduleApiName, recordId, relatedListApiName, fields }: {
    href?: string;
    moduleApiName: string;
    recordId: string;
    relatedListApiName: string;
    fields: string[];
  },
) {
  const basePath = pathFromHref(href || "", recordId, moduleApiName, relatedListApiName);
  const records: JsonObject[] = [];
  let page = 1;
  let pageToken = "";
  for (let requestNumber = 0; requestNumber < 25; requestNumber += 1) {
    const separator = basePath.includes("?") ? "&" : "?";
    const parameters = new URLSearchParams({ fields: fields.join(","), per_page: "200" });
    if (pageToken) parameters.set("page_token", pageToken);
    else parameters.set("page", String(page));
    const payload = await zohoRead(apiDomain, accessToken, `${basePath}${separator}${parameters}`);
    records.push(...rows(payload, "data"));
    if (!payload?.info?.more_records) return records;
    if (payload.info.next_page_token) pageToken = String(payload.info.next_page_token);
    else if (!pageToken && page < 10) page += 1;
    else throw new PreviewError("ZOHO_RELATED_PAGINATION_FAILED");
  }
  throw new PreviewError("ZOHO_RELATED_PAGINATION_FAILED");
}

async function fetchRecord(
  apiDomain: string,
  accessToken: string,
  moduleApiName: string,
  recordId: string,
  fields: string[],
) {
  const parameters = new URLSearchParams({ fields: fields.join(",") });
  const payload = await zohoRead(
    apiDomain,
    accessToken,
    `/crm/v8/${encodeURIComponent(moduleApiName)}/${encodeURIComponent(recordId)}?${parameters}`,
  );
  const record = rows(payload, "data")[0];
  if (!record || String(record.id || "") !== String(recordId)) throw new PreviewError("ZOHO_RECORD_NOT_FOUND");
  return record;
}

function recordLayoutId(record: JsonObject, layoutField: string) {
  return cleanPreviewText(String(record?.[layoutField]?.id || record?.Layout?.id || ""), 100);
}

async function validateRelatedListForLayout(
  auth: { apiDomain: string; accessToken: string },
  moduleApiName: string,
  layoutId: string,
  relation: JsonObject,
) {
  if (!layoutId) throw new PreviewError("ZOHO_SCHEMA_LAYOUT_ID_MISSING");
  const parameters = new URLSearchParams({ module: moduleApiName, layout_id: layoutId });
  const payload = await zohoRead(
    auth.apiDomain,
    auth.accessToken,
    `/crm/v8/settings/related_lists?${parameters}`,
  );
  const match = rows(payload, "related_lists").find((item) =>
    String(item?.id || "") === String(relation.id || "")
    && item?.api_name === relation.apiName
  );
  if (
    !match
    || match.status !== "visible"
    || String(match?.module?.id || "") !== String(relation.targetModuleId || "")
    || cleanPreviewText(match.href, 1_000) !== cleanPreviewText(relation.href, 1_000)
  ) {
    throw new PreviewError("ZOHO_SCHEMA_DRIFT_LAYOUT_RELATED_LIST");
  }
}

async function searchDealsByCreator(
  auth: { apiDomain: string; accessToken: string },
  creatorId: string,
  creatorField: string,
  fields: string[],
) {
  const found: JsonObject[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const parameters = new URLSearchParams({
      criteria: `(${creatorField}:equals:${creatorId})`,
      fields: [...new Set([...fields, creatorField])].join(","),
      page: String(page),
      per_page: "200",
    });
    const payload = await zohoRead(auth.apiDomain, auth.accessToken, `/crm/v8/Deals/search?${parameters}`);
    found.push(...rows(payload, "data"));
    if (!payload?.info?.more_records) break;
    if (page === 10) throw new PreviewError("ZOHO_DEAL_PAGINATION_FAILED");
  }
  return found.filter((deal) => String(deal?.[creatorField]?.id || "") === creatorId);
}

async function searchExactContacts(
  apiDomain: string,
  accessToken: string,
  email: string,
  fields: string[],
  emailFields: string[],
) {
  const found: JsonObject[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const parameters = new URLSearchParams({
      email,
      fields: fields.join(","),
      page: String(page),
      per_page: "200",
    });
    const payload = await zohoRead(apiDomain, accessToken, `/crm/v8/Contacts/search?${parameters}`);
    found.push(...rows(payload, "data"));
    if (!payload?.info?.more_records) break;
    if (page === 10) throw new PreviewError("ZOHO_CONTACT_PAGINATION_FAILED");
  }
  return exactContactMatches(found, email, emailFields);
}

function contactName(contact: JsonObject) {
  return cleanPreviewText(
    contact?.Full_Name
      || [contact?.First_Name, contact?.Last_Name].filter(Boolean).join(" "),
    300,
  );
}

function candidateKey(parts: unknown[]) {
  return parts.map((part) => cleanPreviewText(String(part || "-"), 150)).join("|");
}

async function processAttendee(
  attendee: JsonObject,
  schema: JsonObject,
  auth: { apiDomain: string; accessToken: string },
) {
  if (attendee.sharedMailbox) {
    return {
      result: { status: "ambiguous_shared_mailbox", sharedMailbox: true },
      candidates: [],
    };
  }

  const contactFields = [...new Set([
    ...schema.emailFields,
    ...schema.contactNameFields,
    ...(schema.contactLayoutField ? [schema.contactLayoutField] : []),
    ...(schema.contactCreatorPath.mode === "lookup" ? [schema.contactCreatorPath.apiName] : []),
  ])];
  const contacts = await searchExactContacts(
    auth.apiDomain,
    auth.accessToken,
    attendee.email,
    contactFields,
    schema.emailFields,
  );
  if (contacts.length === 0) return { result: { status: "no_contact" }, candidates: [] };
  if (contacts.length > 1) {
    return {
      result: { status: "ambiguous_contacts" },
      candidates: contacts.map((contact) => ({
        candidate_key: candidateKey([attendee.email, contact.id]),
        contact_id: String(contact.id),
        contact_name: contactName(contact),
        reason_code: "ambiguous_contacts",
        evidence: { sources: attendee.sources },
      })),
    };
  }

  const contact = contacts[0];
  let creators: JsonObject[];
  if (schema.contactCreatorPath.mode === "lookup") {
    creators = lookupRecords(contact?.[schema.contactCreatorPath.apiName]);
  } else {
    await validateRelatedListForLayout(
      auth,
      "Contacts",
      recordLayoutId(contact, schema.contactLayoutField),
      schema.contactCreatorPath,
    );
    creators = (await fetchRelatedRecords(auth.apiDomain, auth.accessToken, {
      href: schema.contactCreatorPath.href,
      moduleApiName: "Contacts",
      recordId: String(contact.id),
      relatedListApiName: schema.contactCreatorPath.apiName,
      fields: [schema.creatorNameField],
    })).map((creator) => ({
      id: String(creator.id || ""),
      name: cleanPreviewText(creator?.[schema.creatorNameField], 300),
    })).filter((creator) => creator.id);
  }
  creators = [...new Map(creators.map((creator) => [creator.id, creator])).values()];

  const contactEvidence = {
    sources: attendee.sources,
    contactCreatorMode: schema.contactCreatorPath.mode,
  };
  if (creators.length === 0) {
    return {
      result: { status: "no_creator" },
      candidates: [{
        candidate_key: candidateKey([attendee.email, contact.id]),
        contact_id: String(contact.id),
        contact_name: contactName(contact),
        reason_code: "no_creator",
        evidence: contactEvidence,
      }],
    };
  }
  if (creators.length > 1) {
    return {
      result: { status: "ambiguous_creators" },
      candidates: creators.map((creator) => ({
        candidate_key: candidateKey([attendee.email, contact.id, creator.id]),
        contact_id: String(contact.id),
        contact_name: contactName(contact),
        creator_id: creator.id,
        creator_name: creator.name,
        reason_code: "ambiguous_creators",
        evidence: contactEvidence,
      })),
    };
  }

  let creator = creators[0];
  const dealFields = [
    "Deal_Name",
    "Stage",
    "Associated_Platform",
    "Owner",
    "Last_Activity_Time",
    "Modified_Time",
    "Pipeline",
    "Layout",
    schema.dealCreatorField,
  ];
  let rawDeals: JsonObject[];
  if (schema.creatorDealsPath.mode === "related_list") {
    const creatorRecord = await fetchRecord(
      auth.apiDomain,
      auth.accessToken,
      schema.creatorModuleApiName,
      creator.id,
      [schema.creatorNameField, schema.creatorLayoutField].filter(Boolean),
    );
    creator = {
      id: creator.id,
      name: cleanPreviewText(creatorRecord?.[schema.creatorNameField], 300) || creator.name,
    };
    await validateRelatedListForLayout(
      auth,
      schema.creatorModuleApiName,
      recordLayoutId(creatorRecord, schema.creatorLayoutField),
      schema.creatorDealsPath,
    );
    rawDeals = await fetchRelatedRecords(auth.apiDomain, auth.accessToken, {
      href: schema.creatorDealsPath.href,
      moduleApiName: schema.creatorModuleApiName,
      recordId: creator.id,
      relatedListApiName: schema.creatorDealsPath.apiName,
      fields: dealFields,
    });
  } else {
    rawDeals = await searchDealsByCreator(auth, creator.id, schema.dealCreatorField, dealFields);
  }
  rawDeals = rawDeals.filter((deal) => String(deal?.[schema.dealCreatorField]?.id || "") === creator.id);
  const deals = rawDeals
    .map((deal) => dealPreview(deal, { activeStages: schema.activeStages }))
    .filter((deal) => deal.id);
  const eligibleDealIds = deals.filter((deal) => deal.eligible).map((deal) => deal.id);
  const status = deals.length === 0
    ? "no_related_deals"
    : eligibleDealIds.length === 0
      ? "no_active_deals"
      : eligibleDealIds.length === 1
        ? "matched"
        : "ambiguous_deals";

  return {
    result: { status, creatorId: creator.id, eligibleDealIds },
    candidates: (deals.length ? deals : [{ id: "", name: "", stage: "", platform: "", owner: "", eligible: false, reason: status }])
      .map((deal) => ({
        candidate_key: candidateKey([attendee.email, contact.id, creator.id, deal.id]),
        contact_id: String(contact.id),
        contact_name: contactName(contact),
        creator_id: creator.id,
        creator_name: creator.name,
        deal_id: deal.id,
        deal_name: deal.name,
        deal_stage: deal.stage,
        platform: deal.platform,
        owner_name: deal.owner,
        eligible: deal.eligible,
        reason_code: deal.reason || status,
        evidence: contactEvidence,
      })),
  };
}

async function updateEvent(
  admin: any,
  eventId: string,
  values: JsonObject,
  processingToken = "",
) {
  let query = admin.from("fathom_post_call_events")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", eventId);
  if (processingToken) query = query.eq("processing_token", processingToken);
  const { data, error } = await query.select("id").maybeSingle();
  if (error || !data?.id) throw new PreviewError("PREVIEW_EVENT_UPDATE_FAILED");
}

async function recordDelivery(
  admin: any,
  eventId: string,
  webhookId: string,
  recordingId: string,
  hash: string,
  allowExisting = false,
) {
  const values = {
    webhook_id: webhookId,
    event_id: eventId,
    recording_id: recordingId,
    payload_sha256: hash,
    delivery_count: 1,
    last_received_at: new Date().toISOString(),
  };
  if (allowExisting) {
    const { data, error } = await admin.from("fathom_webhook_deliveries")
      .select("delivery_count,payload_sha256")
      .eq("webhook_id", webhookId)
      .single();
    if (error || data?.payload_sha256 !== hash) throw new PreviewError("PREVIEW_DELIVERY_READ_FAILED");
    const { error: updateError } = await admin.from("fathom_webhook_deliveries").update({
      delivery_count: Number(data.delivery_count || 0) + 1,
      last_received_at: values.last_received_at,
    }).eq("webhook_id", webhookId).eq("payload_sha256", hash);
    if (updateError) throw new PreviewError("PREVIEW_DELIVERY_WRITE_FAILED");
    return true;
  }
  const { error } = await admin.from("fathom_webhook_deliveries").insert(values);
  if (!error) return true;
  if (error.code !== "23505") throw new PreviewError("PREVIEW_DELIVERY_WRITE_FAILED");
  const { data: existing, error: readError } = await admin.from("fathom_webhook_deliveries")
    .select("delivery_count,payload_sha256")
    .eq("webhook_id", webhookId)
    .single();
  if (readError || existing?.payload_sha256 !== hash) throw new PreviewError("WEBHOOK_ID_PAYLOAD_CONFLICT");
  await admin.from("fathom_webhook_deliveries").update({
    delivery_count: Number(existing.delivery_count || 0) + 1,
    last_received_at: values.last_received_at,
  }).eq("webhook_id", webhookId).eq("payload_sha256", hash);
  return false;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  const secret = env("FATHOM_WEBHOOK_SECRET");
  if (!secret) return json(503, { ok: false, error: "WEBHOOK_NOT_CONFIGURED" });

  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "PAYLOAD_TOO_LARGE" });
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "PAYLOAD_TOO_LARGE" });
  }
  if (!(await validFathomSignature(request, rawBody, secret))) {
    return json(401, { ok: false, error: "INVALID_WEBHOOK_SIGNATURE" });
  }

  const webhookId = cleanPreviewText(request.headers.get("webhook-id"), 200);
  let payload: JsonObject;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { ok: false, error: "INVALID_JSON" });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json(400, { ok: false, error: "INVALID_JSON" });
  }
  if (!Number.isSafeInteger(payload.recording_id) || payload.recording_id <= 0) {
    return json(400, { ok: false, error: "INVALID_RECORDING_ID" });
  }
  if (!Array.isArray(payload.calendar_invitees)) {
    return json(400, { ok: false, error: "INVALID_CALENDAR_INVITEES" });
  }
  if (!validFathomInviteeEnvelope(payload)) {
    return json(400, { ok: false, error: "INCONSISTENT_CALENDAR_INVITEE_ENVELOPE" });
  }

  const recordingId = String(payload.recording_id);
  const payloadHash = await sha256Hex(rawBody);
  const summary = cleanPreviewText(payload?.default_summary?.markdown_formatted, 12_000);
  const actionItems = sanitizeActionItems(payload);
  const attendees = extractExternalAttendees(payload, {
    internalDomains: parseInternalDomains(env("FATHOM_INTERNAL_DOMAINS", "wildvision.io")),
  });
  const supabaseUrl = env("SUPABASE_URL");
  const adminKey = env("SALES_OS_SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !adminKey) return json(503, { ok: false, error: "SUPABASE_NOT_CONFIGURED" });
  const admin = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existingDelivery, error: existingDeliveryError } = await admin
    .from("fathom_webhook_deliveries")
    .select("event_id,payload_sha256,delivery_count")
    .eq("webhook_id", webhookId)
    .maybeSingle();
  if (existingDeliveryError) {
    return json(503, { ok: false, error: "PREVIEW_DELIVERY_READ_FAILED" });
  }
  let replayEvent: JsonObject | null = null;
  if (existingDelivery) {
    if (existingDelivery.payload_sha256 !== payloadHash) {
      console.error(JSON.stringify({ event: "fathom_preview_delivery_hash_conflict", recordingId }));
      return json(409, { ok: false, error: "WEBHOOK_ID_PAYLOAD_CONFLICT", zohoWrite: false });
    }
    const { data: existingEvent } = await admin.from("fathom_post_call_events")
      .select("id,payload_sha256,status,reason_code,attendee_count,candidate_count,processing_token,processing_started_at")
      .eq("id", existingDelivery.event_id)
      .maybeSingle();
    const reprocessAfterSchemaDiscovery = existingEvent?.status === "schema_configuration_required"
      && Boolean(env("ZOHO_PREVIEW_SCHEMA_JSON"));
    if (!reprocessAfterSchemaDiscovery) {
      await admin.from("fathom_webhook_deliveries").update({
        delivery_count: Number(existingDelivery.delivery_count || 0) + 1,
        last_received_at: new Date().toISOString(),
      }).eq("webhook_id", webhookId);
      return json(200, {
        ok: true,
        mode: "preview",
        recordingId,
        duplicate: true,
        status: existingEvent?.status || "received",
        attendeeCount: existingEvent?.attendee_count || 0,
        candidateCount: existingEvent?.candidate_count || 0,
        zohoWrite: false,
      });
    }
    replayEvent = existingEvent;
  }

  let eventId = "";
  let processingToken = "";
  try {
    const now = new Date().toISOString();
    const eventValues = {
      recording_id: recordingId,
      payload_sha256: payloadHash,
      meeting_title: cleanPreviewText(payload.meeting_title || payload.title, 500),
      meeting_url: safeUrl(payload.url || payload.meeting_url),
      share_url: safeUrl(payload.share_url),
      scheduled_start_at: safeDate(payload.scheduled_start_time),
      recorded_by_name: cleanPreviewText(payload?.recorded_by?.name, 200),
      recorded_by_email: normalizeEmail(payload?.recorded_by?.email),
      summary_preview: summary,
      action_items: actionItems,
      proposed_note: buildPreviewNote(payload, recordingId),
      attendee_count: attendees.length,
      candidate_count: 0,
      error_code: null,
      processed_at: null,
      updated_at: now,
    };
    let event = replayEvent;
    if (!event) {
      const { data: inserted, error: insertError } = await admin.from("fathom_post_call_events").insert({
        ...eventValues,
        status: "received",
        reason_code: "",
      }).select("id,payload_sha256,status,processing_token,processing_started_at").single();
      if (!insertError) {
        event = inserted;
      } else if (insertError.code === "23505") {
        const { data: concurrent, error: concurrentError } = await admin.from("fathom_post_call_events")
          .select("id,payload_sha256,status,reason_code,attendee_count,candidate_count,processing_token,processing_started_at")
          .eq("recording_id", recordingId)
          .single();
        if (concurrentError || !concurrent?.id) throw new PreviewError("PREVIEW_EVENT_READ_FAILED");
        event = concurrent;
      } else {
        throw new PreviewError("PREVIEW_EVENT_WRITE_FAILED");
      }
    }
    if (!event?.id) throw new PreviewError("PREVIEW_EVENT_WRITE_FAILED");
    if (event.payload_sha256 && event.payload_sha256 !== payloadHash) {
      console.error(JSON.stringify({ event: "fathom_preview_recording_hash_conflict", recordingId }));
      return json(409, { ok: false, error: "RECORDING_ID_PAYLOAD_CONFLICT", zohoWrite: false });
    }
    eventId = event.id;
    const schemaReplay = event.status === "schema_configuration_required" && Boolean(env("ZOHO_PREVIEW_SCHEMA_JSON"));
    const claimable = event.status === "received" || schemaReplay;
    if (!claimable) {
      await recordDelivery(admin, eventId, webhookId, recordingId, payloadHash, Boolean(existingDelivery));
      return json(200, {
        ok: true,
        mode: "preview",
        recordingId,
        duplicate: true,
        status: event.status || "received",
        zohoWrite: false,
      });
    }

    const claimToken = crypto.randomUUID();
    let claim = admin.from("fathom_post_call_events").update({
      ...eventValues,
      status: "processing",
      reason_code: "",
      processing_token: claimToken,
      processing_started_at: now,
    }).eq("id", eventId).eq("status", event.status);
    claim = event.processing_token
      ? claim.eq("processing_token", event.processing_token)
      : claim.is("processing_token", null);
    const { data: claimed, error: claimError } = await claim.select("id").maybeSingle();
    if (claimError) throw new PreviewError("PREVIEW_EVENT_CLAIM_FAILED");
    if (!claimed?.id) {
      await recordDelivery(admin, eventId, webhookId, recordingId, payloadHash, Boolean(existingDelivery));
      return json(200, {
        ok: true,
        mode: "preview",
        recordingId,
        duplicate: true,
        status: "processing",
        zohoWrite: false,
      });
    }
    processingToken = claimToken;
    await recordDelivery(admin, eventId, webhookId, recordingId, payloadHash, Boolean(existingDelivery));

    const { error: clearError } = await admin.from("fathom_post_call_attendees").delete().eq("event_id", eventId);
    if (clearError) throw new PreviewError("PREVIEW_CHILD_CLEAR_FAILED");
    if (attendees.length > 0) {
      const { error: attendeeError } = await admin.from("fathom_post_call_attendees").insert(
        attendees.map((attendee) => ({
          event_id: eventId,
          normalized_email: attendee.email,
          display_name: attendee.name,
          email_domain: attendee.domain,
          source_labels: attendee.sources,
          fathom_marked_external: attendee.fathomMarkedExternal,
          shared_mailbox: attendee.sharedMailbox,
          resolution_status: "pending",
          reason_code: "",
        })),
      );
      if (attendeeError) throw new PreviewError("PREVIEW_ATTENDEE_WRITE_FAILED");
    }

    if (attendees.length === 0) {
      await updateEvent(admin, eventId, {
        status: "no_external_attendees",
        reason_code: "no_external_attendees",
        processed_at: new Date().toISOString(),
        processing_token: null,
        processing_started_at: null,
      }, processingToken);
      return json(200, { ok: true, mode: "preview", recordingId, status: "no_external_attendees", zohoWrite: false });
    }

    const auth = await getZohoAccessToken();
    const schema = await discoverZohoSchema(auth.apiDomain, auth.accessToken);
    const schemaSnapshot = schema.snapshot;

    if (!schema.configured) {
      await admin.from("fathom_post_call_attendees").update({
        resolution_status: "schema_configuration_required",
        reason_code: "zoho_relationship_schema_not_pinned",
      }).eq("event_id", eventId);
      await updateEvent(admin, eventId, {
        status: "schema_configuration_required",
        reason_code: "zoho_relationship_schema_not_pinned",
        schema_snapshot: schemaSnapshot,
        processed_at: new Date().toISOString(),
        processing_token: null,
        processing_started_at: null,
      }, processingToken);
      return json(200, {
        ok: true,
        mode: "preview",
        recordingId,
        status: "schema_configuration_required",
        zohoWrite: false,
      });
    }

    const attendeeResults = [];
    const candidateRows = [];
    for (const attendee of attendees) {
      const processed = await processAttendee(attendee, schema, auth);
      attendeeResults.push({ ...processed.result, sharedMailbox: attendee.sharedMailbox });
      candidateRows.push(...processed.candidates.map((candidate) => ({
        event_id: eventId,
        attendee_email: attendee.email,
        ...candidate,
      })));
      const { error } = await admin.from("fathom_post_call_attendees").update({
        resolution_status: processed.result.status,
        reason_code: processed.result.status,
      }).eq("event_id", eventId).eq("normalized_email", attendee.email);
      if (error) throw new PreviewError("PREVIEW_ATTENDEE_UPDATE_FAILED");
    }

    if (candidateRows.length > 0) {
      const { error } = await admin.from("fathom_post_call_candidates").insert(candidateRows);
      if (error) throw new PreviewError("PREVIEW_CANDIDATE_WRITE_FAILED");
    }
    const final = resolvePreviewStatus(attendeeResults);
    await updateEvent(admin, eventId, {
      status: final.status,
      reason_code: final.reason,
      schema_snapshot: schemaSnapshot,
      candidate_count: candidateRows.length,
      processed_at: new Date().toISOString(),
      processing_token: null,
      processing_started_at: null,
    }, processingToken);
    console.info(JSON.stringify({
      event: "fathom_preview_completed",
      recordingId,
      status: final.status,
      attendeeCount: attendees.length,
      candidateCount: candidateRows.length,
      zohoWrite: false,
    }));
    return json(200, {
      ok: true,
      mode: "preview",
      recordingId,
      status: final.status,
      attendeeCount: attendees.length,
      candidateCount: candidateRows.length,
      zohoWrite: false,
    });
  } catch (error) {
    const code = error instanceof PreviewError ? error.code : "FATHOM_PREVIEW_FAILED";
    if (eventId && processingToken) {
      try {
        await updateEvent(admin, eventId, {
          status: "failed",
          reason_code: "processing_failed",
          error_code: code,
          processed_at: new Date().toISOString(),
          processing_token: null,
          processing_started_at: null,
        }, processingToken);
      } catch {
        // The verified webhook is still acknowledged below to avoid a retry storm.
      }
    }
    console.error(JSON.stringify({ event: "fathom_preview_failed", recordingId, code }));
    return json(200, {
      ok: false,
      mode: "preview",
      recordingId,
      status: "failed",
      error: code,
      zohoWrite: false,
    });
  }
});
