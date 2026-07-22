import { useEffect, useMemo, useState } from "react";
import { fetchZohoData } from "./zohoApi.js";
import { isAuthRequiredError } from "./sessionRecovery.js";

const ISSUE_STYLES = {
  inactive: { color: "#f59e0b", label: "7+ days inactive" },
  neglected: { color: "#ef4444", label: "3+ months inactive" },
  missing: { color: "#a855f7", label: "Missing information" },
};

function IssueTag({ type, children }) {
  const style = ISSUE_STYLES[type];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${style.color}55`, background: `${style.color}14`, color: style.color, borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap" }}>
      {children || style.label}
    </span>
  );
}

function formatLastActivity(value, daysInactive) {
  if (!value || daysInactive === null || daysInactive === undefined) return "Not recorded";
  if (daysInactive === 0) return "Today";
  if (daysInactive === 1) return "Yesterday";
  if (daysInactive < 14) return `${daysInactive} days ago`;
  if (daysInactive < 60) return `${Math.floor(daysInactive / 7)} weeks ago`;
  if (daysInactive < 730) return `${Math.floor(daysInactive / 30)} months ago`;
  return `${Math.floor(daysInactive / 365)} years ago`;
}

function issueScore(row) {
  if (row.neglected90Days) return 3;
  if (row.inactive7Days) return 2;
  if (row.missingFields?.length) return 1;
  return 0;
}

function compareName(left, right, direction = "asc") {
  const result = left.dealName.localeCompare(right.dealName, undefined, { numeric: true, sensitivity: "base" });
  return direction === "desc" ? -result : result;
}

function compareActivity(left, right, oldestFirst) {
  const leftDays = Number.isFinite(left.daysInactive) ? left.daysInactive : -1;
  const rightDays = Number.isFinite(right.daysInactive) ? right.daysInactive : -1;
  if (leftDays === rightDays) return compareName(left, right);
  return oldestFirst ? rightDays - leftDays : leftDays - rightDays;
}

export default function CrmHygiene({ onAuthRequired }) {
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("urgent");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ alerts: 0, inactive7Days: 0, neglected90Days: 0, missingInformation: 0 });
  const [generatedAt, setGeneratedAt] = useState("");
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestNumber, setRequestNumber] = useState(0);

  useEffect(() => {
    let active = true;
    async function loadRows() {
      setLoading(true);
      setError("");
      try {
        const payload = await fetchZohoData("zoho-crm-hygiene");
        if (!active) return;
        setRows(Array.isArray(payload.rows) ? payload.rows : []);
        setCounts({
          alerts: Number(payload.counts?.alerts || 0),
          inactive7Days: Number(payload.counts?.inactive7Days || 0),
          neglected90Days: Number(payload.counts?.neglected90Days || 0),
          missingInformation: Number(payload.counts?.missingInformation || 0),
        });
        setGeneratedAt(payload.generatedAt || "");
        setStale(payload.stale === true);
      } catch (loadError) {
        if (!active) return;
        setError(loadError.message || "CRM hygiene alerts could not be loaded.");
        if (isAuthRequiredError(loadError)) onAuthRequired?.();
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadRows();
    return () => { active = false; };
  }, [requestNumber, onAuthRequired]);

  useEffect(() => {
    const timer = setInterval(() => setRequestNumber((value) => value + 1), 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const visibleRows = useMemo(() => {
    const searchValue = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesFilter = filter === "all"
        || (filter === "inactive" && row.inactive7Days)
        || (filter === "neglected" && row.neglected90Days)
        || (filter === "missing" && row.missingFields?.length > 0);
      const matchesSearch = !searchValue || [row.dealName, row.creator, row.owner, row.platform, row.stage]
        .some((value) => String(value || "").toLowerCase().includes(searchValue));
      return matchesFilter && matchesSearch;
    }).sort((left, right) => {
      if (sort === "deal-asc") return compareName(left, right);
      if (sort === "deal-desc") return compareName(left, right, "desc");
      if (sort === "activity-oldest") return compareActivity(left, right, true);
      if (sort === "activity-newest") return compareActivity(left, right, false);
      return issueScore(right) - issueScore(left) || compareActivity(left, right, true);
    });
  }, [filter, rows, search, sort]);

  const filterButton = (value, label) => (
    <button type="button" onClick={() => setFilter(value)} style={{ border: `1px solid ${filter === value ? "#ff6700" : "var(--border-strong)"}`, background: filter === value ? "#ff67001c" : "transparent", color: filter === value ? "#ff6700" : "var(--text-muted)", padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 700 }}>
      {label}
    </button>
  );
  const loadingValue = loading && rows.length === 0 ? "—" : null;

  return (
    <div className="fi" style={{ width: "100%", height: "calc(100vh - 52px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 16, flexShrink: 0 }}>
        <div>
          <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 40, lineHeight: 1, textTransform: "uppercase", marginBottom: 6 }}>CRM Hygiene</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Open Zoho Deals that may need attention.</p>
        </div>
        <button type="button" onClick={() => setRequestNumber((value) => value + 1)} disabled={loading} className="btn btn-g btn-sm" style={{ opacity: loading ? 0.6 : 1 }}>Reload</button>
      </div>

      {error && <div role="alert" style={{ background: "#ef444412", border: "1px solid #ef444455", borderRadius: 10, padding: "12px 14px", color: "#ef4444", fontSize: 13, marginBottom: 16, flexShrink: 0 }}><strong>Could not load CRM Hygiene.</strong> {error} No Zoho records were changed.</div>}
      {!error && stale && <div role="status" style={{ background: "#d9770612", border: "1px solid #d9770655", borderRadius: 10, padding: "10px 14px", color: "#d97706", fontSize: 13, marginBottom: 16, flexShrink: 0 }}>Showing the last saved Zoho snapshot because the newest sync has not completed.</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: 12, marginBottom: 16, flexShrink: 0 }}>
        {[
          ["Deals needing attention", loadingValue ?? counts.alerts, "var(--text)"],
          ["Inactive 7–89 days", loadingValue ?? counts.inactive7Days, ISSUE_STYLES.inactive.color],
          ["Inactive 3+ months", loadingValue ?? counts.neglected90Days, ISSUE_STYLES.neglected.color],
          ["Missing information", loadingValue ?? counts.missingInformation, ISSUE_STYLES.missing.color],
        ].map(([label, value, color]) => <div className="card" style={{ padding: 16 }} key={label}><div style={{ color: "var(--text-dim)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>{label}</div><div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 30, fontWeight: 700, color }}>{value}</div></div>)}
      </div>

      <div className="card" style={{ overflow: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 14, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>{filterButton("all", "All")}{filterButton("inactive", "7+ Days")}{filterButton("neglected", "3+ Months")}{filterButton("missing", "Missing Info")}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort CRM hygiene alerts" style={{ width: 190, maxWidth: "100%", padding: "8px 11px", fontSize: 12, cursor: "pointer" }}>
              <option value="urgent">Most urgent</option><option value="activity-oldest">Oldest activity first</option><option value="activity-newest">Newest activity first</option><option value="deal-asc">Deal: A–Z</option><option value="deal-desc">Deal: Z–A</option>
            </select>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search deal, creator or owner..." aria-label="Search CRM hygiene alerts" style={{ width: 245, maxWidth: "100%", padding: "8px 11px", fontSize: 12 }} />
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
          <div role="row" style={{ position: "sticky", top: 0, zIndex: 10, display: "grid", gridTemplateColumns: "29% 27% 16% 17% 11%", minWidth: 880, background: "var(--bg-sub)", borderBottom: "1px solid var(--border)", boxShadow: "0 5px 12px #00000040" }}>
            {["Deal / creator", "Problem", "Owner", "Stage", "Last activity"].map((heading) => <div key={heading} role="columnheader" style={{ padding: "11px 14px", color: "var(--text-dim)", fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase" }}>{heading}</div>)}
          </div>
          {loading && rows.length === 0 && <div role="status" style={{ position: "absolute", inset: "38px 0 0", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 14, pointerEvents: "none" }}>Loading CRM alerts...</div>}
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 880 }}>
            <colgroup><col style={{ width: "29%" }} /><col style={{ width: "27%" }} /><col style={{ width: "16%" }} /><col style={{ width: "17%" }} /><col style={{ width: "11%" }} /></colgroup>
            <tbody aria-live="polite">
              {visibleRows.map((row) => <tr key={row.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: 14, color: "var(--text)" }}><div style={{ fontWeight: 700 }}>{row.dealName}</div><div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>{row.creator}{row.platform ? ` · ${row.platform}` : ""}</div>{row.zohoRecordUrl && <a href={row.zohoRecordUrl} target="_blank" rel="noreferrer" style={{ color: "var(--text-dim)", fontSize: 11, fontWeight: 600 }}>Open Deal in Zoho</a>}</td>
                <td style={{ padding: 14 }}><div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{row.neglected90Days && <IssueTag type="neglected" />}{row.inactive7Days && <IssueTag type="inactive" />}{row.missingFields?.length > 0 && <IssueTag type="missing">Missing: {row.missingFields.join(", ")}</IssueTag>}</div></td>
                <td style={{ padding: 14, color: "var(--text-muted)", fontSize: 13 }}>{row.owner}</td>
                <td style={{ padding: 14, color: "var(--text-muted)", fontSize: 13 }}>{row.stage}</td>
                <td title={row.lastActivityAt || "No activity recorded"} style={{ padding: 14, color: "var(--text-muted)", fontSize: 13, whiteSpace: "nowrap" }}>{formatLastActivity(row.lastActivityAt, row.daysInactive)}</td>
              </tr>)}
              {!loading && !error && visibleRows.length === 0 && <tr><td colSpan="5" style={{ padding: 30, textAlign: "center", color: "var(--text-dim)" }}>No Deals match this filter.</td></tr>}
              {!loading && error && rows.length === 0 && <tr><td colSpan="5" style={{ padding: 30, textAlign: "center", color: "var(--text-dim)" }}>The list is unavailable until the Zoho cache works.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {generatedAt && <div style={{ marginTop: 10, color: "var(--text-dim)", fontSize: 12, flexShrink: 0 }}>Last updated {new Date(generatedAt).toLocaleString()}.</div>}
    </div>
  );
}
