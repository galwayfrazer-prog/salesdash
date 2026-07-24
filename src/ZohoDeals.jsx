import { useMemo, useRef, useState } from "react";
import { isAuthRequiredError } from "./sessionRecovery.js";
import { fetchZohoData } from "./zohoApi.js";

function text(value) {
  return String(value ?? "").trim();
}

function lookupName(value) {
  if (typeof value === "string") return text(value);
  return text(value?.name || value?.display_value || value?.value);
}

function formatDate(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "Not recorded";
  return new Date(timestamp).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dealTime(deal) {
  return Date.parse(deal?.Modified_Time || deal?.Last_Activity_Time || deal?.Created_Time || "") || 0;
}

export default function ZohoDeals({ user, salesData, onAuthRequired }) {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [notesState, setNotesState] = useState({
    loading: false,
    error: "",
    notes: [],
    cached: false,
    stale: false,
    fetchedAt: "",
  });
  const requestIdRef = useRef(0);
  const isManager = user.role === "manager";
  const deals = isManager ? salesData.teamDeals : salesData.ownDeals;
  const detailsLoading = isManager
    ? salesData.teamDetailsLoading
    : salesData.loading && !salesData.ready;
  const detailsError = isManager ? salesData.teamDetailsError : salesData.error;

  const stages = useMemo(() => [...new Set(
    deals.map((deal) => text(deal.Stage)).filter(Boolean),
  )].sort((left, right) => left.localeCompare(right)), [deals]);

  const filteredDeals = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...deals]
      .filter((deal) => {
        if (stage !== "all" && text(deal.Stage) !== stage) return false;
        if (!query) return true;
        return [
          deal.Deal_Name,
          deal.Creator?.name,
          deal.Owner?.name,
          deal.Owner?.email,
          lookupName(deal.Associated_Platform),
          deal.Stage,
        ].some((value) => text(value).toLowerCase().includes(query));
      })
      .sort((left, right) => dealTime(right) - dealTime(left));
  }, [deals, search, stage]);

  async function selectDeal(deal, { forceRefresh = false } = {}) {
    const requestId = ++requestIdRef.current;
    setSelectedDeal(deal);
    setNotesState((previous) => ({
      ...previous,
      loading: true,
      error: "",
      notes: selectedDeal?.id === deal.id ? previous.notes : [],
    }));
    try {
      const payload = await fetchZohoData("zoho-deal-notes", {
        dealId: deal.id,
        ...(forceRefresh ? { refresh: "1" } : {}),
      });
      if (requestId !== requestIdRef.current) return;
      setNotesState({
        loading: false,
        error: "",
        notes: Array.isArray(payload.notes) ? payload.notes : [],
        cached: Boolean(payload.cached),
        stale: Boolean(payload.stale),
        fetchedAt: text(payload.fetchedAt),
      });
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      if (isAuthRequiredError(error)) onAuthRequired?.();
      setNotesState({
        loading: false,
        error: error?.message || "Deal notes could not be loaded.",
        notes: [],
        cached: false,
        stale: false,
        fetchedAt: "",
      });
    }
  }

  const visibleDeals = filteredDeals.slice(0, 200);

  return (
    <div
      className="fi"
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ marginBottom: 18, flexShrink: 0 }}>
        <h1 style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 40, lineHeight: 1, textTransform: "uppercase", marginBottom: 6 }}>Zoho Deals</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Read-only Deal information and notes from Zoho CRM.
        </p>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-dim2)", marginBottom: 14, flexShrink: 0 }}>
        {isManager ? "Managers can inspect team Deals." : "You can inspect Deals assigned to your Zoho email."}
        {salesData.generatedAt ? ` Updated ${new Date(salesData.generatedAt).toLocaleString()}.` : ""}
      </div>

      {detailsError && (
        <div role="alert" style={{ background: "#ef444412", border: "1px solid #ef444455", borderRadius: 10, padding: "11px 14px", color: "#ef4444", fontSize: 13, marginBottom: 14 }}>
          <strong>Could not load Zoho Deals.</strong> {detailsError}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 14, alignItems: "stretch", flex: 1, minHeight: 0 }}>
        <section
          className="card"
          aria-label="Zoho Deals"
          style={{ height: "100%", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}
        >
          <div style={{ display: "flex", gap: 8, padding: 12, borderBottom: "1px solid var(--border)", flexWrap: "wrap", flexShrink: 0 }}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search deal, creator or owner..."
              aria-label="Search Zoho Deals"
              style={{ flex: 1, minWidth: 210, padding: "8px 11px", fontSize: 12 }}
            />
            <select
              value={stage}
              onChange={(event) => setStage(event.target.value)}
              aria-label="Filter by Zoho stage"
              style={{ width: 190, maxWidth: "100%", padding: "8px 11px", fontSize: 12 }}
            >
              <option value="all">All stages</option>
              {stages.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>

          <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 11, flexShrink: 0 }}>
            {filteredDeals.length} Deal{filteredDeals.length === 1 ? "" : "s"}
            {filteredDeals.length > visibleDeals.length ? ` · showing first ${visibleDeals.length}` : ""}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {detailsLoading && deals.length === 0 && (
              <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>Loading Zoho Deals...</div>
            )}
            {!detailsLoading && !detailsError && visibleDeals.length === 0 && (
              <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>No matching Deals.</div>
            )}
            {visibleDeals.map((deal) => {
              const selected = selectedDeal?.id === deal.id;
              const platform = lookupName(deal.Associated_Platform) || "No platform";
              return (
                <button
                  key={deal.id}
                  type="button"
                  onClick={() => selectDeal(deal)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "13px 14px",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    background: selected ? "#ff670012" : "transparent",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontFamily: "'DM Sans',sans-serif",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong style={{ fontSize: 14 }}>{text(deal.Deal_Name) || "Unnamed Deal"}</strong>
                    <span style={{ color: "#ff6700", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{text(deal.Stage) || "No stage"}</span>
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
                    {platform} · {text(deal.Owner?.name) || "Unknown owner"}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section
          className="card"
          aria-label="Selected Deal notes"
          style={{ height: "100%", minHeight: 0, padding: 18, overflow: "hidden", display: "flex", flexDirection: "column" }}
        >
          {!selectedDeal && (
            <div style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center", textAlign: "center", color: "var(--text-muted)" }}>
              Select a Deal to read its Zoho notes.
            </div>
          )}

          {selectedDeal && (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ paddingBottom: 14, borderBottom: "1px solid var(--border)", marginBottom: 14, flexShrink: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>
                    {text(selectedDeal.Deal_Name) || "Unnamed Deal"}
                  </div>
                  <button
                    type="button"
                    onClick={() => selectDeal(selectedDeal, { forceRefresh: true })}
                    disabled={notesState.loading}
                    style={{ flexShrink: 0, padding: "7px 10px", fontSize: 11 }}
                  >
                    {notesState.loading ? "Checking..." : "Refresh notes"}
                  </button>
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6 }}>
                  {text(selectedDeal.Stage) || "No stage"} · {lookupName(selectedDeal.Associated_Platform) || "No platform"} · {text(selectedDeal.Owner?.name) || "Unknown owner"}
                </div>
                <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 4 }}>
                  Last Zoho activity: {formatDate(selectedDeal.Last_Activity_Time)}
                </div>
                {!notesState.loading && !notesState.error && notesState.fetchedAt && (
                  <div style={{ color: notesState.stale ? "#f59e0b" : "var(--text-dim)", fontSize: 10, marginTop: 4 }}>
                    {notesState.stale
                      ? "Showing the last saved copy because Zoho could not be reached."
                      : notesState.cached
                        ? "Loaded from the private 10-minute cache."
                        : "Checked in Zoho and saved privately for 10 minutes."}
                    {" "}Checked {formatDate(notesState.fetchedAt)}.
                  </div>
                )}
              </div>

              {notesState.loading && (
                <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 28, textAlign: "center", color: "var(--text-muted)" }}>Loading Deal notes...</div>
              )}
              {notesState.error && (
                <div role="alert" style={{ background: "#ef444412", border: "1px solid #ef444455", borderRadius: 10, padding: "11px 14px", color: "#ef4444", fontSize: 13 }}>
                  <strong>Could not load notes.</strong> {notesState.error}
                </div>
              )}
              {!notesState.loading && !notesState.error && notesState.notes.length === 0 && (
                <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 28, textAlign: "center", color: "var(--text-muted)" }}>No notes are recorded for this Deal.</div>
              )}
              {!notesState.loading && notesState.notes.length > 0 && (
                <div style={{ flex: 1, minHeight: 0, display: "grid", alignContent: "start", gap: 10, overflowY: "auto" }}>
                  {notesState.notes.map((note) => (
                    <article key={note.id} style={{ background: "var(--bg-inner)", border: "1px solid var(--border-sub)", borderRadius: 9, padding: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                        <strong style={{ fontSize: 13 }}>{note.title}</strong>
                        <span style={{ color: "var(--text-dim)", fontSize: 10, whiteSpace: "nowrap" }}>{formatDate(note.createdAt)}</span>
                      </div>
                      {note.content && <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", marginTop: 8 }}>{note.content}</div>}
                      {note.createdBy && <div style={{ color: "var(--text-dim)", fontSize: 10, marginTop: 8 }}>Added by {note.createdBy}</div>}
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
