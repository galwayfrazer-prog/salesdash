import { useEffect, useState } from "react";
import { fetchZohoData } from "./zohoApi.js";
import { isAuthRequiredError } from "./sessionRecovery.js";

const PLATFORM_COLORS = {
  "Microsoft Start": "#ff00a8",
  Spotify: "#1db954",
};

function displayPlatform(name) {
  return name === "Microsoft Start" ? "MSN" : name;
}

function PlatformTag({ name }) {
  const color = PLATFORM_COLORS[name] || "#ff6700";
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "5px 9px",
      borderRadius: 999,
      border: `1px solid ${color}55`,
      background: `${color}14`,
      color,
      fontSize: 12,
      fontWeight: 700,
      whiteSpace: "nowrap",
    }}>
      {displayPlatform(name)}
    </span>
  );
}

function formatLastActivity(value) {
  if (!value) return "No activity recorded";

  const activityDate = new Date(value);
  if (Number.isNaN(activityDate.getTime())) return "Unknown";

  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(0, Math.floor((Date.now() - activityDate.getTime()) / dayMs));

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function compareCreator(left, right, direction = "asc") {
  const result = left.creator.localeCompare(right.creator, undefined, { numeric: true, sensitivity: "base" });
  return direction === "desc" ? -result : result;
}

function compareLastActivity(left, right, direction) {
  const leftTime = Date.parse(left.lastActivityAt || "");
  const rightTime = Date.parse(right.lastActivityAt || "");
  const leftMissing = Number.isNaN(leftTime);
  const rightMissing = Number.isNaN(rightTime);

  if (leftMissing && rightMissing) return compareCreator(left, right);
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  if (leftTime === rightTime) return compareCreator(left, right);
  return direction === "oldest" ? leftTime - rightTime : rightTime - leftTime;
}

export default function HitList({ onAuthRequired }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("creator-asc");
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({
    opportunities: 0,
    missingSpotify: 0,
    missingMicrosoftStart: 0,
    dealsScanned: 0,
  });
  const [generatedAt, setGeneratedAt] = useState("");
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [request, setRequest] = useState({ sequence: 0, force: false });

  useEffect(() => {
    const controller = new AbortController();

    async function loadHitList() {
      setLoading(true);
      setError("");

      try {
        const payload = await fetchZohoData("zoho-hit-list", request.force ? { refresh: "1" } : {});
        if (controller.signal.aborted) return;

        setRows(Array.isArray(payload.rows) ? payload.rows : []);
        setCounts({
          opportunities: Number(payload.counts?.opportunities || 0),
          missingSpotify: Number(payload.counts?.missingSpotify || 0),
          missingMicrosoftStart: Number(payload.counts?.missingMicrosoftStart || 0),
          dealsScanned: Number(payload.counts?.dealsScanned || 0),
        });
        setGeneratedAt(payload.generatedAt || "");
        setStale(payload.stale === true);
      } catch (loadError) {
        if (loadError.name !== "AbortError") {
          setError(loadError.message || "Zoho data could not be loaded.");
          if (isAuthRequiredError(loadError)) onAuthRequired?.();
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadHitList();
    return () => controller.abort();
  }, [request]);

  useEffect(() => {
    const timer = setInterval(() => {
      setRequest(({ sequence }) => ({ sequence: sequence + 1, force: false }));
    }, 10 * 60 * 1000);

    return () => clearInterval(timer);
  }, []);

  const searchValue = search.trim().toLowerCase();
  const visibleRows = rows
    .filter((row) => {
      const matchesFilter = filter === "all" || row.missingPlatform === filter;
      const matchesSearch = !searchValue
        || row.creator.toLowerCase().includes(searchValue)
        || row.owner.toLowerCase().includes(searchValue);
      return matchesFilter && matchesSearch;
    })
    .sort((left, right) => {
      if (sort === "creator-desc") return compareCreator(left, right, "desc");
      if (sort === "activity-newest") return compareLastActivity(left, right, "newest");
      if (sort === "activity-oldest") return compareLastActivity(left, right, "oldest");
      return compareCreator(left, right);
    });

  const filterButton = (value, label) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      style={{
        border: `1px solid ${filter === value ? "#ff6700" : "var(--border-strong)"}`,
        background: filter === value ? "#ff67001c" : "transparent",
        color: filter === value ? "#ff6700" : "var(--text-muted)",
        padding: "8px 12px",
        borderRadius: 8,
        cursor: "pointer",
        fontFamily: "'DM Sans', sans-serif",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="fi" style={{ width: "100%", height: "calc(100vh - 52px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 16, flexShrink: 0 }}>
        <div>
          <div style={{ marginBottom: 6 }}>
            <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 40, lineHeight: 1, textTransform: "uppercase" }}>Hit List Report</h1>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Creators with a missing Spotify or MSN cross-sell opportunity.</p>
        </div>
        <button
          type="button"
          onClick={() => setRequest(({ sequence }) => ({ sequence: sequence + 1, force: true }))}
          disabled={loading}
          style={{
            border: "1px solid var(--border-strong)",
            background: "transparent",
            color: "var(--text-muted)",
            padding: "8px 12px",
            borderRadius: 8,
            cursor: loading ? "default" : "pointer",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12,
            fontWeight: 700,
            opacity: loading ? 0.6 : 1,
          }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div role="alert" style={{ background: "#ef444412", border: "1px solid #ef444455", borderRadius: 10, padding: "12px 14px", color: "#ef4444", fontSize: 13, marginBottom: 16, flexShrink: 0 }}>
          <strong>Could not load the Hit List.</strong> {error} No CRM records were changed.
        </div>
      )}

      {!error && stale && (
        <div role="status" style={{ background: "#d9770612", border: "1px solid #d9770655", borderRadius: 10, padding: "10px 14px", color: "#d97706", fontSize: 13, marginBottom: 16, flexShrink: 0 }}>
          Showing the last saved list because Zoho could not refresh just now.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16, flexShrink: 0 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ color: "var(--text-dim)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Opportunities</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 30, fontWeight: 700 }}>{loading && rows.length === 0 ? "—" : counts.opportunities}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ color: "var(--text-dim)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Missing Spotify</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 30, fontWeight: 700, color: PLATFORM_COLORS.Spotify }}>{loading && rows.length === 0 ? "—" : counts.missingSpotify}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ color: "var(--text-dim)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Missing MSN</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 30, fontWeight: 700, color: PLATFORM_COLORS["Microsoft Start"] }}>{loading && rows.length === 0 ? "—" : counts.missingMicrosoftStart}</div>
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 14, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {filterButton("all", "All")}
            {filterButton("Spotify", "Needs Spotify")}
            {filterButton("Microsoft Start", "Needs MSN")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              aria-label="Sort Hit List"
              style={{ width: 190, maxWidth: "100%", padding: "8px 11px", fontSize: 12, cursor: "pointer" }}
            >
              <option value="creator-asc">Creator: A–Z</option>
              <option value="creator-desc">Creator: Z–A</option>
              <option value="activity-newest">Last activity: newest first</option>
              <option value="activity-oldest">Last activity: oldest first</option>
            </select>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search creator or owner..."
              aria-label="Search creator or owner"
              style={{ width: 220, maxWidth: "100%", padding: "8px 11px", fontSize: 12 }}
            />
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
          <div
            role="row"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 10,
              display: "grid",
              gridTemplateColumns: "40% 16% 25% 19%",
              minWidth: 620,
              background: "var(--bg-sub)",
              borderBottom: "1px solid var(--border)",
              boxShadow: "0 5px 12px #00000040",
            }}
          >
            {["Creator", "Missing", "Owner", "Last activity"].map((heading) => (
              <div
                key={heading}
                role="columnheader"
                style={{
                  padding: "11px 14px",
                  color: "var(--text-dim)",
                  fontSize: 10,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                }}
              >
                {heading}
              </div>
            ))}
          </div>

          {loading && rows.length === 0 && (
            <div
              role="status"
              style={{
                position: "absolute",
                top: 38,
                right: 0,
                bottom: 0,
                left: 0,
                zIndex: 5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-dim)",
                fontSize: 14,
                pointerEvents: "none",
              }}
            >
              Loading Deals...
            </div>
          )}

          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 620 }}>
            <colgroup>
              <col style={{ width: "40%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "25%" }} />
              <col style={{ width: "19%" }} />
            </colgroup>
            <tbody aria-live="polite">
              {visibleRows.map((row) => (
                <tr key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "14px", fontWeight: 700, color: "var(--text)" }}>
                    <div>{row.creator}</div>
                    {row.zohoRecordUrl && (
                      <a href={row.zohoRecordUrl} target="_blank" rel="noreferrer" style={{ color: "var(--text-dim)", fontSize: 11, fontWeight: 600 }}>Open Deal in Zoho</a>
                    )}
                  </td>
                  <td style={{ padding: "14px" }}><PlatformTag name={row.missingPlatform} /></td>
                  <td style={{ padding: "14px", color: "var(--text-muted)", fontSize: 13 }}>{row.owner}</td>
                  <td title={row.lastActivityAt || "No activity recorded"} style={{ padding: "14px", color: "var(--text-muted)", fontSize: 13, whiteSpace: "nowrap" }}>{formatLastActivity(row.lastActivityAt)}</td>
                </tr>
              ))}
              {!loading && !error && visibleRows.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ padding: 30, textAlign: "center", color: "var(--text-dim)" }}>No creators match this filter.</td>
                </tr>
              )}
              {!loading && error && rows.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ padding: 30, textAlign: "center", color: "var(--text-dim)" }}>The list is unavailable until the Zoho connection works.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {generatedAt && (
        <div style={{ marginTop: 10, color: "var(--text-dim)", fontSize: 12, flexShrink: 0 }}>
          Last updated {new Date(generatedAt).toLocaleString()}. {counts.dealsScanned.toLocaleString()} Deals checked.
        </div>
      )}
    </div>
  );
}
