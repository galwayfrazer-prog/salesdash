export function createEmptyMeetingRecap() {
  return { date: "", summary: "", link: "", tasks: [] };
}

export function hasMeetingRecapContent(recap) {
  return Boolean(
    String(recap?.summary || "").trim()
    || (Array.isArray(recap?.tasks) && recap.tasks.length > 0),
  );
}

export function buildPostedMeetingRecap(draft, { updatedAt = Date.now(), updatedBy = "" } = {}) {
  return {
    ...createEmptyMeetingRecap(),
    ...draft,
    tasks: Array.isArray(draft?.tasks) ? draft.tasks.map(task => ({ ...task })) : [],
    updatedAt,
    updatedBy,
  };
}
