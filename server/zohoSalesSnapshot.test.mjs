import assert from "node:assert/strict";
import {
  clearZohoSalesSnapshots,
  readZohoSalesSnapshot,
  writeZohoSalesSnapshot,
} from "../src/zohoSalesSnapshot.js";

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

const user = { email: "Filip.Stanic@wildvision.io", role: "manager" };
const storage = memoryStorage();
const now = Date.parse("2026-07-22T12:00:00Z");
const generatedAt = "2026-07-22T11:55:00Z";

assert.equal(writeZohoSalesSnapshot(user, {
  generatedAt,
  ownDeals: [{ id: "own-1" }],
  teamEvents: [{ id: "event-1" }],
}, storage, now), true);

assert.deepEqual(readZohoSalesSnapshot(user, storage, now + 1000), {
  generatedAt,
  stale: false,
  ownDeals: [{ id: "own-1" }],
  teamDeals: [],
  teamEvents: [{ id: "event-1" }],
  cached: true,
});

assert.equal(readZohoSalesSnapshot({ ...user, email: "other@wildvision.io" }, storage, now), null);
assert.equal(readZohoSalesSnapshot(user, storage, now + 13 * 60 * 60 * 1000), null);

writeZohoSalesSnapshot(user, { generatedAt, ownDeals: [], teamEvents: [] }, storage, now);
clearZohoSalesSnapshots(storage);
assert.equal(storage.length, 0);

console.log("Zoho sales session snapshot test passed.");
