import { CRM_HYGIENE_RULES } from "./crmHygiene.mjs";

const DEFAULT_INTERNAL_DOMAINS = ["wildvision.io"];
const SHARED_MAILBOX_PREFIXES = new Set([
  "accounts",
  "admin",
  "billing",
  "bookings",
  "careers",
  "contact",
  "finance",
  "hello",
  "hr",
  "info",
  "legal",
  "marketing",
  "office",
  "ops",
  "partnerships",
  "press",
  "sales",
  "support",
  "team",
]);

const TERMINAL_STAGES = new Set(CRM_HYGIENE_RULES.terminalStages);
const PAUSED_STAGES = new Set(CRM_HYGIENE_RULES.pausedStages);

export function cleanPreviewText(value, maxLength = 500) {
  return typeof value === "string"
    ? value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim().slice(0, maxLength)
    : "";
}

export function normalizeEmail(value) {
  const email = cleanPreviewText(value, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function verifyFathomSignature({
  webhookId,
  timestampText,
  signatureHeader,
  rawBody,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
  maxAgeSeconds = 5 * 60,
} = {}) {
  const id = cleanPreviewText(webhookId, 200);
  const timestampValue = cleanPreviewText(timestampText, 30);
  const signatures = cleanPreviewText(signatureHeader, 4_000);
  if (!id || !timestampValue || !signatures || typeof secret !== "string" || !secret.startsWith("whsec_")) {
    return false;
  }
  const timestamp = Number(timestampValue);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > maxAgeSeconds) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      decodeBase64(secret.slice("whsec_".length)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${id}.${timestampValue}.${String(rawBody ?? "")}`),
    ));
    return signatures.split(/\s+/).some((versionedSignature) => {
      const separator = versionedSignature.indexOf(",");
      if (separator < 0 || versionedSignature.slice(0, separator) !== "v1") return false;
      try {
        return constantTimeEqual(expected, decodeBase64(versionedSignature.slice(separator + 1)));
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function parseInternalDomains(value) {
  const supplied = Array.isArray(value) ? value : String(value || "").split(",");
  const domains = supplied
    .map((item) => cleanPreviewText(String(item), 255).toLowerCase().replace(/^@/, ""))
    .filter((item) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(item));
  return [...new Set(domains.length ? domains : DEFAULT_INTERNAL_DOMAINS)];
}

export function isSharedMailbox(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const localPart = normalized.slice(0, normalized.indexOf("@")).split("+")[0];
  return SHARED_MAILBOX_PREFIXES.has(localPart);
}

function payloadArray(value) {
  return Array.isArray(value) ? value : [];
}

export function validFathomInviteeEnvelope(payload) {
  const type = cleanPreviewText(payload?.calendar_invitees_domains_type, 100);
  if (!type) return true;
  if (!["only_internal", "one_or_more_external"].includes(type)) return false;
  const hasFathomExternal = payloadArray(payload?.calendar_invitees)
    .some((invitee) => invitee?.is_external === true);
  return type === "one_or_more_external" ? hasFathomExternal : !hasFathomExternal;
}

function evidenceForEmail(payload, email) {
  const sources = new Set(["calendar_invitee"]);
  for (const segment of payloadArray(payload?.transcript)) {
    if (normalizeEmail(segment?.speaker?.matched_calendar_invitee_email) === email) {
      sources.add("transcript_speaker");
    }
  }
  for (const action of payloadArray(payload?.action_items)) {
    if (normalizeEmail(action?.assignee?.email) === email) sources.add("action_assignee");
  }
  return [...sources].sort();
}

export function extractExternalAttendees(payload, {
  internalDomains = DEFAULT_INTERNAL_DOMAINS,
} = {}) {
  const internal = new Set(parseInternalDomains(internalDomains));
  const recorderEmail = normalizeEmail(payload?.recorded_by?.email);
  const attendees = new Map();

  for (const invitee of payloadArray(payload?.calendar_invitees)) {
    if (invitee?.is_external !== true) continue;
    const email = normalizeEmail(invitee?.email);
    if (!email || email === recorderEmail) continue;
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if ([...internal].some((internalDomain) =>
      domain === internalDomain || domain.endsWith(`.${internalDomain}`)
    )) continue;
    const suppliedDomain = cleanPreviewText(invitee?.email_domain, 255).toLowerCase();
    if (suppliedDomain && suppliedDomain !== domain) continue;

    const existing = attendees.get(email);
    const name = cleanPreviewText(
      invitee?.name || invitee?.matched_speaker_display_name || existing?.name,
      200,
    );
    attendees.set(email, {
      email,
      name,
      domain,
      fathomMarkedExternal: invitee?.is_external === true,
      sharedMailbox: isSharedMailbox(email),
      sources: evidenceForEmail(payload, email),
    });
  }

  return [...attendees.values()].sort((left, right) => left.email.localeCompare(right.email));
}

export function exactContactMatches(records, email, emailFields) {
  const wanted = normalizeEmail(email);
  if (!wanted) return [];
  const matches = new Map();
  for (const record of payloadArray(records)) {
    const exact = payloadArray(emailFields).some((field) => normalizeEmail(record?.[field]) === wanted);
    const id = cleanPreviewText(String(record?.id || ""), 100);
    if (exact && id) matches.set(id, record);
  }
  return [...matches.values()];
}

function configuredItem(items, configuredApiName) {
  if (!configuredApiName) return null;
  return items.find((item) => item.api_name === configuredApiName) || null;
}

export function selectContactCreatorPath({
  fields = [],
  relatedLists = [],
  creatorModuleApiName,
  configuredLookupField = "",
  configuredRelatedList = "",
} = {}) {
  const lookupCandidates = payloadArray(fields).filter((field) =>
    field?.data_type === "lookup" && field?.lookup?.module?.api_name === creatorModuleApiName
  );
  const relatedCandidates = payloadArray(relatedLists).filter((related) =>
    related?.module?.api_name === creatorModuleApiName && related?.status === "visible"
  );

  if (configuredLookupField) {
    const selected = configuredItem(lookupCandidates, configuredLookupField);
    return selected
      ? { ok: true, mode: "lookup", apiName: selected.api_name, candidates: [selected.api_name] }
      : { ok: false, reason: "configured_lookup_not_found", candidates: lookupCandidates.map((item) => item.api_name) };
  }
  if (configuredRelatedList) {
    const selected = configuredItem(relatedCandidates, configuredRelatedList);
    return selected
      ? { ok: true, mode: "related_list", apiName: selected.api_name, href: selected.href || "", candidates: [selected.api_name] }
      : { ok: false, reason: "configured_related_list_not_found", candidates: relatedCandidates.map((item) => item.api_name) };
  }
  if (lookupCandidates.length === 1) {
    return { ok: true, mode: "lookup", apiName: lookupCandidates[0].api_name, candidates: [lookupCandidates[0].api_name] };
  }
  if (lookupCandidates.length === 0 && relatedCandidates.length === 1) {
    return {
      ok: true,
      mode: "related_list",
      apiName: relatedCandidates[0].api_name,
      href: relatedCandidates[0].href || "",
      candidates: [relatedCandidates[0].api_name],
    };
  }
  return {
    ok: false,
    reason: lookupCandidates.length > 1 || relatedCandidates.length > 1
      ? "creator_relationship_ambiguous"
      : "creator_relationship_not_found",
    candidates: [
      ...lookupCandidates.map((item) => `lookup:${item.api_name}`),
      ...relatedCandidates.map((item) => `related:${item.api_name}`),
    ],
  };
}

export function selectCreatorDealsRelatedList(relatedLists, configuredApiName = "") {
  const candidates = payloadArray(relatedLists).filter((related) =>
    related?.module?.api_name === "Deals" && related?.status === "visible"
  );
  if (configuredApiName) {
    const selected = configuredItem(candidates, configuredApiName);
    return selected
      ? { ok: true, apiName: selected.api_name, href: selected.href || "", candidates: [selected.api_name] }
      : { ok: false, reason: "configured_deals_related_list_not_found", candidates: candidates.map((item) => item.api_name) };
  }
  return candidates.length === 1
    ? { ok: true, apiName: candidates[0].api_name, href: candidates[0].href || "", candidates: [candidates[0].api_name] }
    : {
      ok: false,
      reason: candidates.length > 1 ? "deals_related_list_ambiguous" : "deals_related_list_not_found",
      candidates: candidates.map((item) => item.api_name),
    };
}

export function lookupRecords(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const records = new Map();
  for (const item of values) {
    const id = cleanPreviewText(String(item?.id || ""), 100);
    if (!id) continue;
    records.set(id, {
      id,
      name: cleanPreviewText(item?.name || item?.display_value || item?.value, 300),
    });
  }
  return [...records.values()];
}

export function dealPreview(deal, { activeStages = [] } = {}) {
  const stage = cleanPreviewText(deal?.Stage, 200);
  const stageKey = stage.toLowerCase();
  const allowed = new Set(payloadArray(activeStages).map((value) => cleanPreviewText(value, 200).toLowerCase()));
  const eligible = Boolean(stageKey) && allowed.has(stageKey);
  const knownInactive = TERMINAL_STAGES.has(stageKey) || PAUSED_STAGES.has(stageKey);
  return {
    id: cleanPreviewText(String(deal?.id || ""), 100),
    name: cleanPreviewText(deal?.Deal_Name, 300) || "Unnamed Deal",
    stage,
    platform: cleanPreviewText(
      typeof deal?.Associated_Platform === "string"
        ? deal.Associated_Platform
        : deal?.Associated_Platform?.name,
      200,
    ),
    owner: cleanPreviewText(deal?.Owner?.name, 200),
    eligible,
    reason: eligible
      ? "active_deal"
      : knownInactive
        ? TERMINAL_STAGES.has(stageKey) ? "terminal_stage" : "paused_stage"
        : "unclassified_stage",
  };
}

export function resolvePreviewStatus(attendeeResults) {
  if (!Array.isArray(attendeeResults) || attendeeResults.length === 0) {
    return { status: "no_external_attendees", reason: "no_external_attendees" };
  }
  if (attendeeResults.some((result) => result.sharedMailbox)) {
    return { status: "ambiguous", reason: "shared_mailbox_manual_review" };
  }
  if (attendeeResults.some((result) => result.status === "schema_configuration_required")) {
    return { status: "schema_configuration_required", reason: "zoho_relationship_schema_not_pinned" };
  }
  const matched = attendeeResults.filter((result) => result.status === "matched");
  const unresolved = attendeeResults.filter((result) => result.status !== "matched");
  if (matched.length > 0 && unresolved.length > 0) {
    return { status: "partial_match", reason: "some_attendees_unresolved" };
  }
  if (unresolved.length > 0) {
    const ambiguous = unresolved.some((result) => String(result.status).startsWith("ambiguous"));
    return { status: ambiguous ? "ambiguous" : "no_match", reason: unresolved[0].status };
  }

  const targets = new Set();
  for (const result of matched) {
    if (!result.creatorId || !Array.isArray(result.eligibleDealIds) || result.eligibleDealIds.length !== 1) {
      return {
        status: result.eligibleDealIds?.length > 1 ? "ambiguous" : "no_match",
        reason: result.eligibleDealIds?.length > 1 ? "ambiguous_deals" : "no_active_deal",
      };
    }
    targets.add(`${result.creatorId}:${result.eligibleDealIds[0]}`);
  }
  return targets.size === 1
    ? { status: "ready_for_review", reason: "single_converged_target" }
    : { status: "ambiguous", reason: "attendees_resolve_to_different_targets" };
}

export function buildPreviewNote(payload, recordingId) {
  const summary = cleanPreviewText(payload?.default_summary?.markdown_formatted, 12_000);
  const actions = payloadArray(payload?.action_items)
    .map((action) => cleanPreviewText(action?.description, 1_000))
    .filter(Boolean)
    .slice(0, 50);
  return [
    "Fathom meeting note preview",
    `[FATHOM_RECORDING_ID:${cleanPreviewText(String(recordingId || ""), 100)}]`,
    "",
    "Summary:",
    summary || "No summary text was included in this webhook event.",
    "",
    "Action items:",
    actions.length ? actions.map((action) => `- ${action}`).join("\n") : "No action items were included in this webhook event.",
    "",
    "Safety: Preview only. No Zoho record was changed.",
  ].join("\n").slice(0, 20_000);
}

export function assertReadOnlyZohoRequest(method, path) {
  if (String(method || "GET").toUpperCase() !== "GET") throw new Error("ZOHO_WRITE_BLOCKED");
  const normalizedPath = String(path || "");
  if (!normalizedPath.startsWith("/crm/v8/") || normalizedPath.includes("\\")) {
    throw new Error("ZOHO_PATH_BLOCKED");
  }
  const parsed = new URL(`https://preview.invalid${normalizedPath}`);
  const segments = parsed.pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      throw new Error("ZOHO_PATH_BLOCKED");
    }
  });
  if (segments.some((segment) => segment.toLowerCase() === "notes" || segment === "..")) {
    throw new Error("ZOHO_NOTES_BLOCKED");
  }
  const route = segments.slice(2);
  const safeApiName = (value) => /^[A-Za-z][A-Za-z0-9_]*$/.test(value || "");
  const allowedRoute = (
    route.length === 2 && route[0] === "settings" && ["modules", "fields", "layouts", "related_lists"].includes(route[1])
  ) || (
    route.length === 2 && route[0] === "Contacts" && route[1] === "search"
  ) || (
    route.length === 2 && safeApiName(route[0]) && !["settings", "Notes"].includes(route[0]) && /^\d+$/.test(route[1])
  ) || (
    route.length === 3
      && safeApiName(route[0])
      && !["settings", "Notes"].includes(route[0])
      && /^\d+$/.test(route[1])
      && safeApiName(route[2])
  ) || (
    route.length === 2 && route[0] === "Deals" && route[1] === "search"
  );
  if (!allowedRoute) throw new Error("ZOHO_PATH_BLOCKED");
  const allowedQuery = new Set([
    "criteria",
    "email",
    "fields",
    "layout_id",
    "module",
    "page",
    "page_token",
    "per_page",
  ]);
  for (const key of parsed.searchParams.keys()) {
    if (!allowedQuery.has(key)) throw new Error("ZOHO_QUERY_BLOCKED");
  }
  return true;
}
