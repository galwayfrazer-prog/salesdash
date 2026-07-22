import { clean } from "./hitList.mjs";

function lookup(value) {
  if (!value) return { id: "", name: "", email: "" };
  if (typeof value === "string") return { id: "", name: clean(value), email: "" };
  return {
    id: clean(String(value.id || "")),
    name: clean(value.name || value.display_value || value.value),
    email: clean(value.email).toLowerCase(),
  };
}

function platform(value) {
  if (!value) return { name: "" };
  if (typeof value === "string") return { name: clean(value) };
  if (Array.isArray(value)) {
    return { name: value.map((item) => platform(item).name).filter(Boolean).join(", ") };
  }
  return { name: clean(value.name || value.display_value || value.value) };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildDealFacts(deals) {
  return deals
    .map((deal) => {
      const dealName = clean(deal.Deal_Name);
      const stage = clean(deal.Stage);
      const associatedPlatform = platform(deal.Associated_Platform);
      const creator = lookup(deal.Creator);
      const owner = lookup(deal.Owner);
      const lastActivity = clean(deal.Last_Activity_Time);
      const missingCoreFields = [];

      if (!dealName) missingCoreFields.push("Deal name");
      if (!creator.name) missingCoreFields.push("Creator");
      if (!associatedPlatform.name) missingCoreFields.push("Platform");
      if (!owner.name) missingCoreFields.push("Owner");
      if (!stage) missingCoreFields.push("Stage");
      if (!lastActivity || Number.isNaN(Date.parse(lastActivity))) {
        missingCoreFields.push("Last activity");
      }

      return {
        id: clean(String(deal.id || "")),
        Deal_Name: dealName || "Unnamed Deal",
        Stage: stage,
        Creator: creator,
        Associated_Platform: associatedPlatform,
        WV_Percentage: numberOrNull(deal.WV_Percentage),
        Closing_Date: clean(deal.Closing_Date),
        Created_Time: clean(deal.Created_Time),
        Modified_Time: clean(deal.Modified_Time),
        Last_Activity_Time: lastActivity,
        Owner: owner,
        Pipeline: clean(deal.Pipeline),
        Layout: lookup(deal.Layout),
        Missing_Core_Fields: missingCoreFields,
      };
    })
    .filter((deal) => deal.id);
}
