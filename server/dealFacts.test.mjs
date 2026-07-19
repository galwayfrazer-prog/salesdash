import assert from "node:assert/strict";
import { buildDealFacts } from "../supabase/functions/_shared/dealFacts.mjs";
import { filterDealFacts } from "./zohoHitList.mjs";

const facts = buildDealFacts([{
  id: "deal-1",
  Deal_Name: "Test Deal",
  Stage: "Live",
  Associated_Platform: { id: "platform-1", name: "Spotify" },
  WV_Percentage: "55",
  Closing_Date: "2026-07-01",
  Created_Time: "2026-06-01T10:00:00+01:00",
  Modified_Time: "2026-07-02T10:00:00+01:00",
  Last_Activity_Time: "2026-07-02T09:00:00+01:00",
  Owner: { id: "owner-1", name: "Test Rep", email: "REP@WILDVISION.IO" },
  Pipeline: "Standard",
  Layout: { id: "layout-1", name: "Deals" },
}]);

assert.equal(facts.length, 1);
assert.equal(facts[0].WV_Percentage, 55);
assert.equal(facts[0].Associated_Platform.name, "Spotify");
assert.equal(facts[0].Owner.email, "rep@wildvision.io");
assert.equal(facts[0].Layout.name, "Deals");
assert.deepEqual(filterDealFacts(facts, { ownerEmail: "REP@WILDVISION.IO" }), facts);
assert.deepEqual(filterDealFacts(facts, { ownerEmail: "other@wildvision.io" }), []);
assert.deepEqual(filterDealFacts(facts, { team: true }), facts);
assert.throws(() => filterDealFacts(facts), { code: "ZOHO_OWNER_REQUIRED" });
console.log("Zoho Deal facts test passed.");
