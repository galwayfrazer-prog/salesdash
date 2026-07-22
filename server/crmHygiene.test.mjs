import assert from "node:assert/strict";
import {
  buildCrmHygieneRows,
  crmHygieneCounts,
} from "../supabase/functions/_shared/crmHygiene.mjs";
import { buildDealFacts } from "../supabase/functions/_shared/dealFacts.mjs";

const now = new Date("2026-07-22T12:00:00.000Z");
const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
const deal = (overrides = {}) => ({
  id: `deal-${Math.random()}`,
  Deal_Name: "Test Creator - Spotify",
  Creator: { id: "creator-1", name: "Test Creator" },
  Associated_Platform: { name: "Spotify" },
  Stage: "Interested",
  Owner: { id: "owner-1", name: "Test Rep", email: "rep@wildvision.io" },
  Last_Activity_Time: daysAgo(2),
  ...overrides,
});

const rows = buildCrmHygieneRows(buildDealFacts([
  deal({ id: "recent" }),
  deal({ id: "seven", Last_Activity_Time: daysAgo(7) }),
  deal({ id: "eighty-nine", Last_Activity_Time: daysAgo(89) }),
  deal({ id: "ninety", Last_Activity_Time: daysAgo(90) }),
  deal({ id: "missing-creator", Creator: null }),
  deal({ id: "missing-activity", Last_Activity_Time: null }),
  deal({ id: "finished", Stage: "Live", Last_Activity_Time: daysAgo(200) }),
  deal({ id: "lost", Stage: "Lost", Creator: null, Last_Activity_Time: null }),
  deal({ id: "paused", Stage: "Paused Deal", Last_Activity_Time: daysAgo(200) }),
  deal({ id: "paused-missing", Stage: "Paused Deal", Creator: null }),
]), { now });

assert.equal(rows.some((row) => row.id === "recent"), false);
assert.equal(rows.find((row) => row.id === "seven")?.inactive7Days, true);
assert.equal(rows.find((row) => row.id === "eighty-nine")?.inactive7Days, true);
assert.equal(rows.find((row) => row.id === "ninety")?.neglected90Days, true);
assert.deepEqual(rows.find((row) => row.id === "missing-creator")?.missingFields, ["Creator"]);
assert.deepEqual(rows.find((row) => row.id === "missing-activity")?.missingFields, ["Last activity"]);
assert.equal(rows.some((row) => row.id === "finished"), false);
assert.equal(rows.some((row) => row.id === "lost"), false);
assert.equal(rows.some((row) => row.id === "paused"), false);
assert.deepEqual(rows.find((row) => row.id === "paused-missing")?.missingFields, ["Creator"]);

assert.deepEqual(crmHygieneCounts(rows), {
  alerts: 6,
  inactive7Days: 2,
  neglected90Days: 1,
  missingInformation: 3,
});

assert.match(rows[0].zohoRecordUrl, /crm\.zoho\.eu\/crm\/wildvisionltd\/tab\/Potentials\//);
console.log("CRM hygiene rules test passed.");
