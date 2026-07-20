import assert from "node:assert/strict";
import {
  buildPostedMeetingRecap,
  createEmptyMeetingRecap,
  hasMeetingRecapContent,
} from "../src/meetingRecap.mjs";

const currentRecap = {
  date: "10 July 2026",
  summary: "Frazer's current recap",
  link: "https://example.com/recording",
  tasks: [{ id: 1, task: "Keep this task", assignee: "All" }],
};

const draft = createEmptyMeetingRecap(currentRecap);
assert.deepEqual(draft, { date: "", summary: "", link: "", tasks: [] });
assert.notEqual(draft, currentRecap);
assert.equal(hasMeetingRecapContent(draft), false);
assert.equal(hasMeetingRecapContent({ summary: "  ", tasks: [] }), false);
assert.equal(hasMeetingRecapContent({ summary: "New recap", tasks: [] }), true);
assert.equal(hasMeetingRecapContent({ summary: "", tasks: [{ task: "Follow up" }] }), true);

const posted = buildPostedMeetingRecap(
  { ...draft, summary: "New recap", tasks: [{ id: 2, task: "New task", assignee: "All" }] },
  { updatedAt: 1234, updatedBy: "manager@wildvision.io" },
);
assert.deepEqual(posted, {
  date: "",
  summary: "New recap",
  link: "",
  tasks: [{ id: 2, task: "New task", assignee: "All" }],
  updatedAt: 1234,
  updatedBy: "manager@wildvision.io",
});

posted.tasks[0].task = "Changed after posting";
assert.equal(currentRecap.tasks[0].task, "Keep this task");

console.log("Meeting recap tests passed.");
