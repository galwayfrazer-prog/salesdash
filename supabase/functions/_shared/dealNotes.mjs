function clean(value) {
  return String(value ?? "").trim();
}

function personName(value) {
  if (typeof value === "string") return clean(value);
  return clean(value?.name || value?.display_value || value?.value);
}

function noteText(value) {
  return clean(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .trim();
}

export const DEAL_NOTES_CACHE_TTL_MS = 10 * 60 * 1000;

export function validZohoDealId(value) {
  return /^\d+$/.test(clean(value));
}

export function canReadDealNotes(member, deal) {
  if (member?.role === "manager") return true;
  const memberEmail = clean(member?.email).toLowerCase();
  const ownerEmail = clean(deal?.owner_email || deal?.Owner?.email).toLowerCase();
  return Boolean(memberEmail && ownerEmail && memberEmail === ownerEmail);
}

export function sanitizeZohoNotes(payload) {
  return (Array.isArray(payload?.data) ? payload.data : []).map((note) => ({
    id: clean(note?.id),
    title: clean(note?.Note_Title) || "Untitled note",
    content: noteText(note?.Note_Content),
    createdAt: clean(note?.Created_Time),
    modifiedAt: clean(note?.Modified_Time),
    createdBy: personName(note?.Created_By),
    modifiedBy: personName(note?.Modified_By),
  })).filter((note) => note.id);
}

export function normalizeCachedDealNotes(value) {
  return (Array.isArray(value) ? value : []).map((note) => ({
    id: clean(note?.id),
    title: clean(note?.title) || "Untitled note",
    content: noteText(note?.content),
    createdAt: clean(note?.createdAt),
    modifiedAt: clean(note?.modifiedAt),
    createdBy: clean(note?.createdBy),
    modifiedBy: clean(note?.modifiedBy),
  })).filter((note) => note.id);
}

export function isFreshDealNotesCache(
  cache,
  now = Date.now(),
  ttlMs = DEAL_NOTES_CACHE_TTL_MS,
) {
  const fetchedAt = Date.parse(cache?.fetched_at || cache?.fetchedAt || "");
  return Number.isFinite(fetchedAt)
    && now >= fetchedAt
    && now - fetchedAt < ttlMs;
}
