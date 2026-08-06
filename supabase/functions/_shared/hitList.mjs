const DEFAULT_API_DOMAIN = "https://www.zohoapis.eu";

export function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function lookupName(value) {
  if (!value) return "";
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.map(lookupName).filter(Boolean).join(", ");
  return clean(value.name || value.display_value || value.value);
}

function lookupId(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return clean(String(value.id || ""));
}

function platformNames(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(platformNames);

  const name = lookupName(value);
  if (!name) return [];

  return name
    .split(/[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normaliseName(value) {
  return clean(value).replace(/\s+/g, " ").toLowerCase();
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

function newestDeal(current, candidate) {
  if (!current) return candidate;
  return timestamp(candidate.Last_Activity_Time) > timestamp(current.Last_Activity_Time)
    ? candidate
    : current;
}

function zohoRecordUrl(apiDomain, orgSlug, dealId) {
  if (!orgSlug || !dealId) return "";
  const suffix = apiDomain.match(/zohoapis(\.[a-z.]+)$/i)?.[1] || ".com";
  return `https://crm.zoho${suffix}/crm/${encodeURIComponent(orgSlug)}/tab/Potentials/${dealId}`;
}

export function buildHitList(
  deals,
  { apiDomain = DEFAULT_API_DOMAIN, orgSlug = "" } = {},
) {
  const creators = new Map();
  const microsoftStart = normaliseName("Microsoft Start");
  const spotify = normaliseName("Spotify");

  for (const deal of deals) {
    const creatorName = lookupName(deal.Creator);
    if (!creatorName) continue;

    const creatorId = lookupId(deal.Creator) || normaliseName(creatorName);
    const existing = creators.get(creatorId) || {
      creatorId,
      creatorName,
      hasMicrosoftStart: false,
      hasSpotify: false,
      liveMicrosoftStartDeal: null,
      liveSpotifyDeal: null,
      livePlatforms: new Map(),
    };
    const platformLabels = platformNames(deal.Associated_Platform);
    const names = platformLabels.map(normaliseName);
    const isLive = normaliseName(deal.Stage) === "live";

    if (isLive) {
      for (const platform of platformLabels) {
        const key = normaliseName(platform);
        if (key && !existing.livePlatforms.has(key)) existing.livePlatforms.set(key, platform);
      }
    }

    if (names.includes(microsoftStart)) {
      existing.hasMicrosoftStart = true;
      if (isLive) existing.liveMicrosoftStartDeal = newestDeal(existing.liveMicrosoftStartDeal, deal);
    }

    if (names.includes(spotify)) {
      existing.hasSpotify = true;
      if (isLive) existing.liveSpotifyDeal = newestDeal(existing.liveSpotifyDeal, deal);
    }

    creators.set(creatorId, existing);
  }

  const rows = [];

  for (const creator of creators.values()) {
    let liveDeal = null;
    let livePlatform = "";
    let missingPlatform = "";

    if (creator.liveMicrosoftStartDeal && !creator.hasSpotify) {
      liveDeal = creator.liveMicrosoftStartDeal;
      livePlatform = "Microsoft Start";
      missingPlatform = "Spotify";
    } else if (creator.liveSpotifyDeal && !creator.hasMicrosoftStart) {
      liveDeal = creator.liveSpotifyDeal;
      livePlatform = "Spotify";
      missingPlatform = "Microsoft Start";
    }

    if (!liveDeal) continue;

    const dealId = clean(String(liveDeal.id || ""));
    rows.push({
      id: `${creator.creatorId}:${normaliseName(missingPlatform)}`,
      creator: creator.creatorName,
      livePlatform,
      currentPlatforms: [...creator.livePlatforms.values()].sort((left, right) => left.localeCompare(
        right,
        undefined,
        { numeric: true, sensitivity: "base" },
      )),
      missingPlatform,
      owner: lookupName(liveDeal.Owner) || "Unassigned",
      lastActivityAt: clean(liveDeal.Last_Activity_Time),
      dealId,
      zohoRecordUrl: zohoRecordUrl(apiDomain, orgSlug, dealId),
    });
  }

  rows.sort((left, right) => left.creator.localeCompare(
    right.creator,
    undefined,
    { numeric: true, sensitivity: "base" },
  ));

  return rows;
}

export function hitListCounts(rows, dealsScanned) {
  return {
    dealsScanned,
    opportunities: rows.length,
    missingSpotify: rows.filter((row) => row.missingPlatform === "Spotify").length,
    missingMicrosoftStart: rows.filter((row) => row.missingPlatform === "Microsoft Start").length,
  };
}
