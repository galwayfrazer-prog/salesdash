import assert from "node:assert/strict";
import {
  canReadDealNotes,
  sanitizeZohoNotes,
  validZohoDealId,
} from "../supabase/functions/_shared/dealNotes.mjs";

assert.equal(validZohoDealId("456269000049575119"), true);
assert.equal(validZohoDealId("../Notes"), false);

const deal = { owner_email: "rep@wildvision.io" };
assert.equal(canReadDealNotes({ role: "manager", email: "manager@wildvision.io" }, deal), true);
assert.equal(canReadDealNotes({ role: "rep", email: "rep@wildvision.io" }, deal), true);
assert.equal(canReadDealNotes({ role: "rep", email: "other@wildvision.io" }, deal), false);

assert.deepEqual(sanitizeZohoNotes({
  data: [{
    id: "1",
    Note_Title: "Call summary",
    Note_Content: "<b>Creator is interested</b>",
    Created_Time: "2026-07-23T10:00:00+04:00",
    Created_By: { name: "Sales Rep" },
  }],
}), [{
  id: "1",
  title: "Call summary",
  content: "Creator is interested",
  createdAt: "2026-07-23T10:00:00+04:00",
  modifiedAt: "",
  createdBy: "Sales Rep",
  modifiedBy: "",
}]);

console.log("Zoho Deal notes tests passed.");
