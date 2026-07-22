const HANDOFF_STAGES = new Set([
  "Ready to Submit to Platform",
  "Awaiting Platform Approval",
  "Awaiting Platform Approval or Page Access",
  "Ready to go Live",
  "Live",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function name(value) {
  if (typeof value === "string") return clean(value);
  return clean(value?.name || value?.display_value || value?.value);
}

function platform(value) {
  const raw = name(value);
  if (raw === "Microsoft Start") return "MSN";
  return raw || "Other";
}

function dateKey(value) {
  const raw = clean(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : "";
}

function owner(deal) {
  const source = deal.Owner || {};
  return {
    email: clean(source.email || deal.owner_email).toLowerCase(),
    name: clean(source.name || deal.owner_name),
  };
}

export function buildTeamSalesSummary(deals) {
  const grouped = new Map();

  for (const deal of Array.isArray(deals) ? deals : []) {
    const stage = clean(deal.Stage || deal.stage);
    if (!HANDOFF_STAGES.has(stage)) continue;

    const dealOwner = owner(deal);
    const date = dateKey(
      deal.Closing_Date || deal.closing_date || deal.Created_Time || deal.created_time,
    );
    if (!dealOwner.email || !date) continue;

    const dealPlatform = platform(deal.Associated_Platform || deal.associated_platform);
    const key = `${dealOwner.email}\u0000${date}\u0000${dealPlatform}`;
    const current = grouped.get(key) || {
      ownerEmail: dealOwner.email,
      ownerName: dealOwner.name,
      date,
      platform: dealPlatform,
      count: 0,
    };

    current.count += 1;
    grouped.set(key, current);
  }

  return [...grouped.values()].sort((a, b) => (
    a.ownerEmail.localeCompare(b.ownerEmail)
    || a.date.localeCompare(b.date)
    || a.platform.localeCompare(b.platform)
  ));
}
