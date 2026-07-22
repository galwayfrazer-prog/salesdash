import assert from "node:assert/strict";
import { filterDealsForPeriod } from "../src/salesPeriod.js";

const now = new Date("2026-07-19T12:00:00+02:00");
const deals = [
  { id: "before", Closing_Date: "2026-06-30" },
  { id: "start", Closing_Date: "2026-07-01" },
  { id: "inside", Created_Time: "2026-09-30T12:00:00+02:00" },
  { id: "future", Closing_Date: "2026-10-01" },
  { id: "invalid", Closing_Date: "not-a-date" },
];

assert.deepEqual(filterDealsForPeriod(deals, "quarter", now).map(({ id }) => id), ["start"]);
assert.deepEqual(filterDealsForPeriod(deals, "all", now).map(({ id }) => id), ["before", "start"]);
console.log("Sales period boundary test passed.");
