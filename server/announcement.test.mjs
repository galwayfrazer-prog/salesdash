import assert from "node:assert/strict";
import {
  buildPostedAnnouncement,
  createEmptyAnnouncement,
} from "../src/announcement.mjs";

assert.deepEqual(createEmptyAnnouncement(), { text: "", emoji: "📣" });

assert.deepEqual(
  buildPostedAnnouncement(
    { text: "  A new update  ", emoji: "🚀", from: "Wrong old author", ts: 1 },
    { displayName: "Filip Stanic", email: "Filip.Stanic@wildvision.io" },
    1234,
  ),
  {
    text: "A new update",
    emoji: "🚀",
    from: "Filip Stanic",
    postedBy: "filip.stanic@wildvision.io",
    ts: 1234,
  },
);

assert.equal(buildPostedAnnouncement({ text: "   " }, { displayName: "Filip" }), null);

console.log("Announcement attribution test passed.");
