const SNAPSHOT_VERSION = 1;
const SNAPSHOT_PREFIX = "wvos:zoho-sales-snapshot:v1:";
const MAX_SNAPSHOT_AGE_MS = 12 * 60 * 60 * 1000;
const STALE_AFTER_MS = 20 * 60 * 1000;
const MAX_SNAPSHOT_SIZE = 1_500_000;

function text(value) {
  return String(value ?? "").trim();
}

function identity(user) {
  const email = text(user?.email).toLowerCase();
  const role = user?.role === "manager" ? "manager" : "rep";
  return { email, role };
}

function keyFor(user) {
  const { email, role } = identity(user);
  return `${SNAPSHOT_PREFIX}${role}:${email}`;
}

function generatedAgeMs(generatedAt, now) {
  const timestamp = Date.parse(text(generatedAt));
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : Number.POSITIVE_INFINITY;
}

export function writeZohoSalesSnapshot(user, data, storage = globalThis.sessionStorage, now = Date.now()) {
  if (!storage?.setItem) return false;
  const { email, role } = identity(user);
  if (!email) return false;

  const snapshot = {
    version: SNAPSHOT_VERSION,
    email,
    role,
    savedAt: now,
    generatedAt: text(data?.generatedAt),
    stale: data?.stale === true,
    ownDeals: Array.isArray(data?.ownDeals) ? data.ownDeals : [],
    teamEvents: Array.isArray(data?.teamEvents) ? data.teamEvents : [],
  };

  try {
    let serialized = JSON.stringify(snapshot);
    if (serialized.length > MAX_SNAPSHOT_SIZE) {
      snapshot.ownDeals = [];
      serialized = JSON.stringify(snapshot);
    }
    storage.setItem(keyFor(user), serialized);
    return true;
  } catch {
    return false;
  }
}

export function readZohoSalesSnapshot(user, storage = globalThis.sessionStorage, now = Date.now()) {
  if (!storage?.getItem) return null;
  const { email, role } = identity(user);
  if (!email) return null;

  try {
    const raw = storage.getItem(keyFor(user));
    if (!raw) return null;
    const snapshot = JSON.parse(raw);
    const savedAt = Number(snapshot?.savedAt);
    if (
      snapshot?.version !== SNAPSHOT_VERSION
      || snapshot?.email !== email
      || snapshot?.role !== role
      || !Number.isFinite(savedAt)
      || now - savedAt < 0
      || now - savedAt > MAX_SNAPSHOT_AGE_MS
      || !Array.isArray(snapshot?.ownDeals)
      || !Array.isArray(snapshot?.teamEvents)
    ) {
      storage.removeItem(keyFor(user));
      return null;
    }

    return {
      generatedAt: text(snapshot.generatedAt),
      stale: snapshot.stale === true || generatedAgeMs(snapshot.generatedAt, now) > STALE_AFTER_MS,
      ownDeals: snapshot.ownDeals,
      teamDeals: [],
      teamEvents: snapshot.teamEvents,
      cached: true,
    };
  } catch {
    try { storage.removeItem(keyFor(user)); } catch {}
    return null;
  }
}

export function clearZohoSalesSnapshots(storage = globalThis.sessionStorage) {
  if (!storage?.length || !storage?.key || !storage?.removeItem) return;
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(SNAPSHOT_PREFIX)) storage.removeItem(key);
    }
  } catch {}
}
