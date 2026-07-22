import { clean } from "./hitList.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

const TERMINAL_STAGES = new Set([
  "closed lost to competition",
  "live",
  "lost",
  "pass through revenue",
  "rejected by platform",
  "rejected internally",
  "terminated contract",
]);

const PAUSED_STAGES = new Set([
  "conversations on pause",
  "paused deal",
]);

function stageKey(value) {
  return clean(value).toLowerCase();
}

function validDate(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function missingFieldsForDeal(deal) {
  const supplied = Array.isArray(deal.Missing_Core_Fields)
    ? deal.Missing_Core_Fields.map(clean).filter(Boolean)
    : [];
  if (supplied.length > 0) return [...new Set(supplied)];

  const fields = [];
  if (!clean(deal.Deal_Name) || deal.Deal_Name === "Unnamed Deal") fields.push("Deal name");
  if (!clean(deal.Creator?.name)) fields.push("Creator");
  if (!clean(deal.Associated_Platform?.name)) fields.push("Platform");
  if (!clean(deal.Owner?.name)) fields.push("Owner");
  if (!clean(deal.Stage)) fields.push("Stage");
  if (!validDate(deal.Last_Activity_Time)) fields.push("Last activity");
  return fields;
}

export function buildCrmHygieneRows(deals, {
  now = new Date(),
  apiDomain = "https://crm.zoho.eu",
  orgSlug = "wildvisionltd",
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("A valid current time is required.");

  return deals.flatMap((deal) => {
    const id = clean(String(deal.id || ""));
    if (!id) return [];

    const stage = clean(deal.Stage);
    const normalisedStage = stageKey(stage);
    const terminal = TERMINAL_STAGES.has(normalisedStage);
    const paused = PAUSED_STAGES.has(normalisedStage);
    const open = !terminal;
    const eligibleForInactivityAlert = open && !paused;
    const activityMs = validDate(deal.Last_Activity_Time);
    const daysInactive = activityMs === null
      ? null
      : Math.max(0, Math.floor((nowMs - activityMs) / DAY_MS));
    const missingFields = open ? missingFieldsForDeal(deal) : [];
    const neglected90Days = eligibleForInactivityAlert
      && daysInactive !== null
      && daysInactive >= 90;
    const inactive7Days = eligibleForInactivityAlert
      && daysInactive !== null
      && daysInactive >= 7
      && daysInactive < 90;

    if (!inactive7Days && !neglected90Days && missingFields.length === 0) return [];

    const webDomain = clean(apiDomain)
      .replace("https://www.zohoapis.eu", "https://crm.zoho.eu")
      .replace(/\/$/, "");

    return [{
      id,
      dealId: id,
      dealName: clean(deal.Deal_Name) || "Unnamed Deal",
      creator: clean(deal.Creator?.name) || "Creator missing",
      platform: clean(deal.Associated_Platform?.name),
      stage: stage || "Stage missing",
      owner: clean(deal.Owner?.name) || "Owner missing",
      ownerEmail: clean(deal.Owner?.email).toLowerCase(),
      lastActivityAt: activityMs === null ? "" : new Date(activityMs).toISOString(),
      daysInactive,
      inactive7Days,
      neglected90Days,
      missingFields,
      zohoRecordUrl: `${webDomain}/crm/${clean(orgSlug)}/tab/Potentials/${encodeURIComponent(id)}`,
    }];
  });
}

export function crmHygieneCounts(rows) {
  return rows.reduce((counts, row) => {
    counts.alerts += 1;
    if (row.inactive7Days) counts.inactive7Days += 1;
    if (row.neglected90Days) counts.neglected90Days += 1;
    if (row.missingFields.length > 0) counts.missingInformation += 1;
    return counts;
  }, {
    alerts: 0,
    inactive7Days: 0,
    neglected90Days: 0,
    missingInformation: 0,
  });
}

export const CRM_HYGIENE_RULES = Object.freeze({
  inactiveDays: 7,
  neglectedDays: 90,
  terminalStages: [...TERMINAL_STAGES],
  pausedStages: [...PAUSED_STAGES],
});
