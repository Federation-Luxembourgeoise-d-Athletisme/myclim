import { useMemo } from "react";
import { useEmagazineStats } from "../site/emagazine-stats";

function formatNumber(value) {
  return Number(value || 0).toLocaleString("fr-LU");
}

function formatDay(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename, rows) {
  // BOM so Excel opens the accents correctly.
  const blob = new Blob([`\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function StatTile({ label, value, hint }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: 12, background: "#fff", border: "1px solid #dbe4ee" }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#607086" }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: "1.6rem", fontWeight: 800, color: "#10253d" }}>{value}</div>
      {hint ? <div style={{ marginTop: 2, fontSize: "0.75rem", color: "#6b7280" }}>{hint}</div> : null}
    </div>
  );
}

// pageOrder: [{ statsId, title }] in magazine order, to list pages the way
// they appear (pages never viewed included) with their current title.
export function EmagazineStatsPanel({ year, pageOrder = [] }) {
  const { summary, pages, days, loading, error } = useEmagazineStats(year);

  const opens = summary?.opens || 0;
  const totalPageViews = pages.reduce((sum, page) => sum + (page.views || 0), 0);

  const pageRows = useMemo(() => {
    const viewsById = new Map(pages.map((page) => [page.id, page]));
    const rows = pageOrder.map((page, index) => ({
      id: page.statsId,
      number: index + 1,
      title: page.title,
      views: viewsById.get(page.statsId)?.views || 0,
    }));
    const listed = new Set(rows.map((row) => row.id));
    // Pages viewed earlier but since removed or renamed.
    pages
      .filter((page) => !listed.has(page.id))
      .forEach((page) => rows.push({ id: page.id, number: null, title: page.title || page.id, views: page.views || 0 }));
    return rows;
  }, [pages, pageOrder]);

  const maxPageViews = Math.max(1, ...pageRows.map((row) => row.views));
  const recentDays = days.slice(-30);
  const maxDayOpens = Math.max(1, ...recentDays.map((day) => day.opens || 0));

  function handleExport() {
    downloadCsv(`e-magazine-${year}-audience.csv`, [
      [`E-magazine ${year} — audience`],
      ["Opens (visits)", opens],
      ["Unique readers", summary?.uniqueReaders || 0],
      ["Page views", totalPageViews],
      ["Pages per visit", opens ? (totalPageViews / opens).toFixed(1) : "0"],
      ["Print / PDF", summary?.prints || 0],
      [],
      ["Page", "Title", "Views", "% of visits"],
      ...pageRows.map((row) => [row.number ?? "—", row.title, row.views, opens ? `${Math.round((row.views / opens) * 100)}%` : "0%"]),
      [],
      ["Day", "Opens"],
      ...days.map((day) => [day.id, day.opens || 0]),
    ]);
  }

  return (
    <div style={{ padding: 20, borderRadius: 16, background: "#f8fbff", border: "1px solid #dbe4ee", display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0, color: "#10253d" }}>Audience {year}</h3>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: "0.84rem", maxWidth: 680 }}>
            Counted on the public site only (the admin preview is ignored). A visit is one browsing session;
            a page view is a page shown at least 1.5 s, counted once per visit.
          </p>
        </div>
        <button className="btn btn--secondary" type="button" style={{ fontSize: "0.8rem" }} onClick={handleExport} disabled={loading}>
          Export CSV for sponsors
        </button>
      </div>

      {error ? <p style={{ margin: 0, color: "#c62828", fontSize: "0.84rem" }}>{error}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <StatTile label="Visits" value={loading ? "…" : formatNumber(opens)} />
        <StatTile label="Unique readers" value={loading ? "…" : formatNumber(summary?.uniqueReaders)} hint="Distinct browsers" />
        <StatTile label="Page views" value={loading ? "…" : formatNumber(totalPageViews)} />
        <StatTile label="Pages per visit" value={loading ? "…" : opens ? (totalPageViews / opens).toFixed(1) : "0"} />
        <StatTile label="Print / PDF" value={loading ? "…" : formatNumber(summary?.prints)} />
      </div>

      {!loading && opens === 0 && totalPageViews === 0 ? (
        <p style={{ margin: 0, color: "#6b7280", fontSize: "0.82rem" }}>No visit recorded yet for this edition.</p>
      ) : null}

      {recentDays.length > 0 ? (
        <div style={{ display: "grid", gap: 8 }}>
          <strong style={{ color: "#10253d", fontSize: "0.9rem" }}>Visits per day{days.length > 30 ? " (last 30 days)" : ""}</strong>
          <div style={{ display: "flex", alignItems: "end", gap: 4, height: 110, padding: "8px 10px", background: "#fff", border: "1px solid #dbe4ee", borderRadius: 12, overflowX: "auto" }}>
            {recentDays.map((day) => (
              <div key={day.id} title={`${formatDay(day.id)} : ${day.opens || 0}`} style={{ flex: "1 0 14px", maxWidth: 36, display: "grid", gap: 4, justifyItems: "center", alignSelf: "stretch", alignContent: "end" }}>
                <div style={{ width: "100%", height: `${Math.max(4, ((day.opens || 0) / maxDayOpens) * 70)}px`, background: "#163c6b", borderRadius: 4 }} />
                <span style={{ fontSize: "0.62rem", color: "#607086", whiteSpace: "nowrap" }}>{formatDay(day.id).split(" ")[0]}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 8 }}>
        <strong style={{ color: "#10253d", fontSize: "0.9rem" }}>Views per page</strong>
        <div style={{ background: "#fff", border: "1px solid #dbe4ee", borderRadius: 12, overflow: "hidden" }}>
          {pageRows.map((row) => (
            <div key={row.id} style={{ display: "grid", gridTemplateColumns: "40px minmax(0, 1fr) minmax(80px, 30%) 70px", gap: 12, alignItems: "center", padding: "8px 14px", borderTop: "1px solid #eef2f7", fontSize: "0.84rem" }}>
              <span style={{ color: "#607086", fontWeight: 700 }}>{row.number ? `#${row.number}` : "—"}</span>
              <span style={{ color: "#10253d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</span>
              <span style={{ height: 8, borderRadius: 4, background: "#eef2f7", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${(row.views / maxPageViews) * 100}%`, background: "#c11a34" }} />
              </span>
              <span style={{ textAlign: "right", fontWeight: 700, color: "#10253d" }}>{formatNumber(row.views)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
