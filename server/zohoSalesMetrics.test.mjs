import assert from "node:assert/strict";
import {
  buildZohoPerformanceEvents,
  buildZohoPerformanceEventsFromSummary,
  computeZohoOutcomeStats,
  normalizeZohoPlatform,
  performanceEventsForOwner,
} from "../src/zohoSalesMetrics.js";
import { buildTeamSalesSummary } from "../supabase/functions/_shared/teamSalesSummary.mjs";

const now = new Date("2026-07-22T12:00:00Z");
const base = {
  id: "1",
  Deal_Name: "Example creator",
  Associated_Platform: { name: "Microsoft Start" },
  Owner: { email: "REP@wildvision.io", name: "Rep" },
  Created_Time: "2026-07-01T10:00:00Z",
  Closing_Date: "2026-07-20",
  WV_Percentage: null,
};

assert.equal(normalizeZohoPlatform({ name: "Microsoft Start" }), "MSN");

const events = buildZohoPerformanceEvents([
  { ...base, Stage: "Live" },
  { ...base, id: "2", Stage: "Awaiting Platform Approval or Page Access" },
  { ...base, id: "3", Stage: "Rejected by Platform" },
  { ...base, id: "4", Stage: "Live", Closing_Date: "2026-08-01" },
  { ...base, id: "5", Stage: "Live", WV_Percentage: 0 },
], now);

assert.equal(events.length, 4);
assert.equal(events[0].submittedBy, "rep@wildvision.io");
assert.equal(events[0].platform, "MSN");
assert.equal(events[0].split, null);
assert.equal(events[2].futureDated, true);
assert.equal(events[3].split, null, "zero/placeholder split values must stay unavailable");
assert.equal(
  performanceEventsForOwner(events, "rep@wildvision.io", Date.parse("2026-07-01"), now.getTime()).length,
  3,
  "future-dated handoffs must not count yet",
);

const outcomes = computeZohoOutcomeStats([
  { ...base, Stage: "Live" },
  { ...base, Stage: "Lost" },
  { ...base, Stage: "Rejected Internally" },
  { ...base, Stage: "Rejected by Platform" },
  { ...base, Stage: "Closed Lost to Competition" },
  { ...base, Stage: "Contacted" },
]);
assert.equal(outcomes.positive.length, 1);
assert.equal(outcomes.negative.length, 4);
assert.equal(outcomes.rate, 20);

const teamSummary = buildTeamSalesSummary([
  { ...base, Stage: "Live" },
  { ...base, id: "2", Stage: "Ready to go Live" },
  { ...base, id: "3", Stage: "Lost" },
]);
assert.equal(teamSummary.length, 1);
assert.equal(teamSummary[0].count, 2);
assert.equal("percentageTotal" in teamSummary[0], false, "team summaries must not expose colleague split data");
assert.equal(buildZohoPerformanceEventsFromSummary(teamSummary, now).length, 2);

const todayRaw = buildZohoPerformanceEvents([{ ...base, Stage:"Live", Closing_Date:"2026-07-22" }], new Date("2026-07-22T08:00:00Z"));
const todaySummary = buildZohoPerformanceEventsFromSummary(buildTeamSalesSummary([{ ...base, Stage:"Live", Closing_Date:"2026-07-22" }]), new Date("2026-07-22T08:00:00Z"));
assert.equal(performanceEventsForOwner(todayRaw, "rep@wildvision.io", 0, Date.parse("2026-07-22T08:00:00Z")).length, 1);
assert.equal(performanceEventsForOwner(todaySummary, "rep@wildvision.io", 0, Date.parse("2026-07-22T08:00:00Z")).length, 1);

console.log("Zoho sales metrics test passed.");
