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
    .map((deal) => ({
      id: clean(String(deal.id || "")),
      Deal_Name: clean(deal.Deal_Name) || "Unnamed Deal",
      Stage: clean(deal.Stage),
      Associated_Platform: platform(deal.Associated_Platform),
      WV_Percentage: numberOrNull(deal.WV_Percentage),
      Closing_Date: clean(deal.Closing_Date),
      Created_Time: clean(deal.Created_Time),
      Modified_Time: clean(deal.Modified_Time),
      Last_Activity_Time: clean(deal.Last_Activity_Time),
      Owner: lookup(deal.Owner),
      Pipeline: clean(deal.Pipeline),
      Layout: lookup(deal.Layout),
    }))
    .filter((deal) => deal.id);
}
