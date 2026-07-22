export const PROVISIONAL_SALES_HANDOFF_STAGES = Object.freeze([
  "Ready to Submit to Platform",
  "Awaiting Platform Approval",
  "Awaiting Platform Approval or Page Access",
  "Ready to go Live",
  "Live",
]);

export const NEGATIVE_OUTCOME_STAGES = Object.freeze([
  "Lost",
  "Rejected Internally",
  "Rejected by Platform",
  "Closed Lost to Competition",
]);

const PLATFORM_ALIASES = Object.freeze({
  Facebook: "Facebook",
  MSN: "MSN",
  "Microsoft Start": "MSN",
  Spotify: "Spotify",
});

function text(value) {
  return String(value ?? "").trim();
}

function lookupName(value) {
  if (typeof value === "string") return text(value);
  return text(value?.name || value?.display_value || value?.value);
}

export function normalizeZohoPlatform(value) {
  const raw = lookupName(value);
  return PLATFORM_ALIASES[raw] || raw || "Other";
}

export function zohoPerformanceDate(deal) {
  return text(deal?.Closing_Date || deal?.Created_Time);
}

export function isProvisionalSalesHandoff(deal) {
  return PROVISIONAL_SALES_HANDOFF_STAGES.includes(text(deal?.Stage));
}

export function isNegativeSalesOutcome(deal) {
  return NEGATIVE_OUTCOME_STAGES.includes(text(deal?.Stage));
}

export function buildZohoPerformanceEvents(deals, now = new Date()) {
  const nowTime = now.getTime();
  return (Array.isArray(deals) ? deals : [])
    .filter(isProvisionalSalesHandoff)
    .map((deal) => {
      const contractDate = zohoPerformanceDate(deal);
      const timestamp = contractDate ? new Date(contractDate).getTime() : Number.NaN;
      const percentage = deal?.WV_Percentage === null
        || deal?.WV_Percentage === undefined
        || deal?.WV_Percentage === ""
        ? null
        : Number(deal.WV_Percentage);

      return {
        id: text(deal?.id),
        dealName: text(deal?.Deal_Name) || "Unnamed Deal",
        platform: normalizeZohoPlatform(deal?.Associated_Platform),
        split: Number.isFinite(percentage) && percentage > 0 ? percentage : null,
        contractDate,
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
        futureDated: Number.isFinite(timestamp) && timestamp > nowTime,
        status: "approved",
        submittedBy: text(deal?.Owner?.email).toLowerCase(),
        submittedByName: text(deal?.Owner?.name),
        source: "zoho",
        zohoStage: text(deal?.Stage),
      };
    });
}

export function buildZohoPerformanceEventsFromSummary(summary, now = new Date()) {
  const events = [];
  for (const row of Array.isArray(summary) ? summary : []) {
    const count = Math.max(0, Math.floor(Number(row?.count) || 0));
    for (let index = 0; index < count; index += 1) {
      const contractDate = text(row?.date);
      const timestamp = contractDate ? new Date(`${contractDate}T00:00:00Z`).getTime() : Number.NaN;
      events.push({
        id: `summary:${text(row?.ownerEmail)}:${contractDate}:${text(row?.platform)}:${index}`,
        dealName: "Team sales handoff",
        platform: normalizeZohoPlatform(row?.platform),
        split: null,
        contractDate,
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
        futureDated: Number.isFinite(timestamp) && timestamp > now.getTime(),
        status: "approved",
        submittedBy: text(row?.ownerEmail).toLowerCase(),
        submittedByName: text(row?.ownerName),
        source: "zoho-summary",
        zohoStage: "Provisional sales handoff",
      });
    }
  }
  return events;
}

export function performanceEventsForOwner(events, email, since = 0, until = Date.now()) {
  const ownerEmail = text(email).toLowerCase();
  return (Array.isArray(events) ? events : []).filter((event) => (
    event.submittedBy === ownerEmail
    && Number.isFinite(event.timestamp)
    && event.timestamp >= since
    && event.timestamp <= until
  ));
}

export function computeZohoOutcomeStats(deals) {
  const source = Array.isArray(deals) ? deals : [];
  const positive = source.filter(isProvisionalSalesHandoff);
  const negative = source.filter(isNegativeSalesOutcome);
  const outcomes = positive.length + negative.length;

  return {
    positive,
    negative,
    outcomes,
    rate: outcomes > 0 ? Math.round((positive.length / outcomes) * 100) : null,
  };
}

export function hasUsableZohoSplitData(events) {
  return (Array.isArray(events) ? events : []).some((event) => Number.isFinite(event.split) && event.split > 0);
}
