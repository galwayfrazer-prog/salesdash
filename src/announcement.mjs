export function createEmptyAnnouncement() {
  return { text: "", emoji: "📣" };
}

export function buildPostedAnnouncement(draft, author, timestamp = Date.now()) {
  const text = String(draft?.text || "").trim().slice(0, 200);
  if (!text) return null;

  return {
    text,
    emoji: String(draft?.emoji || "📣"),
    from: String(author?.displayName || "Team manager"),
    postedBy: String(author?.email || "").trim().toLowerCase(),
    ts: timestamp,
  };
}
