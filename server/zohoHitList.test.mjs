import assert from "node:assert/strict";
import { buildHitList } from "./zohoHitList.mjs";

const deals = [
  {
    id: "deal-1",
    Creator: { id: "creator-1", name: "Creator One" },
    Associated_Platform: { name: "Microsoft Start" },
    Stage: "Live",
    Owner: { name: "Rep A" },
    Last_Activity_Time: "2026-07-15T10:00:00+02:00",
  },
  {
    id: "deal-2",
    Creator: { id: "creator-2", name: "Creator Two" },
    Associated_Platform: { name: "Spotify" },
    Stage: "Live",
    Owner: { name: "Rep B" },
    Last_Activity_Time: "2026-07-14T10:00:00+02:00",
  },
  {
    id: "deal-2b",
    Creator: { id: "creator-2", name: "Creator Two" },
    Associated_Platform: { name: "YouTube" },
    Stage: "Live",
    Owner: { name: "Rep B" },
    Last_Activity_Time: "2026-07-13T10:00:00+02:00",
  },
  {
    id: "deal-3",
    Creator: { id: "creator-3", name: "Creator Three" },
    Associated_Platform: { name: "Microsoft Start" },
    Stage: "Live",
  },
  {
    id: "deal-4",
    Creator: { id: "creator-3", name: "Creator Three" },
    Associated_Platform: { name: "Spotify" },
    Stage: "Rejected",
  },
  {
    id: "deal-5",
    Creator: { id: "creator-4", name: "Creator Four" },
    Associated_Platform: { name: "Spotify" },
    Stage: "Contacted",
  },
];

const rows = buildHitList(deals, {
  apiDomain: "https://www.zohoapis.eu",
  orgSlug: "wildvisionltd",
});
const result = rows.map(({ creator, livePlatform, missingPlatform }) => ({
  creator,
  livePlatform,
  missingPlatform,
}));

assert.deepEqual(result, [
  {
    creator: "Creator One",
    livePlatform: "Microsoft Start",
    missingPlatform: "Spotify",
  },
  {
    creator: "Creator Two",
    livePlatform: "Spotify",
    missingPlatform: "Microsoft Start",
  },
]);

assert.equal(
  rows[1].zohoRecordUrl,
  "https://crm.zoho.eu/crm/wildvisionltd/tab/Potentials/deal-2",
);
assert.deepEqual(rows[1].currentPlatforms, ["Spotify", "YouTube"]);

console.log("Hit List rule test passed.");
