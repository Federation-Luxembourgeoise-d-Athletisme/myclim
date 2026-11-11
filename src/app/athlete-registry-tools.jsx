import { useMemo, useState } from "react";
import { REGISTRY_SORTS, buildRegistryAnalysis, registrySuspectReasonLabel } from "./athlete-registry-analysis";
import { useTr } from "./use-tr";

// Outils de la page Base athlètes : filtres + tri, tableau paginé, analyse
// statistique et liste des fiches à nettoyer.

const PAGE_SIZE = 100;

function formatName(entry) {
  return [entry.firstName, entry.lastName].filter(Boolean).join(" ") || "—";
}

async function exportRegistryRows(rows, tr) {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(tr("Base athlètes", "Athlete database"));
  sheet.columns = [
    { header: tr("Nom", "Last name"), key: "lastName", width: 22 },
    { header: tr("Prénom", "First name"), key: "firstName", width: 18 },
    { header: tr("Nationalité", "Nationality"), key: "nationality", width: 11 },
    { header: tr("Genre", "Gender"), key: "gender", width: 7 },
    { header: tr("Naissance", "Birth"), key: "birth", width: 12 },
    { header: "WAID", key: "waid", width: 12 },
    { header: tr("Nb éditions", "No. of editions"), key: "editionCount", width: 11 },
    { header: tr("Éditions", "Editions"), key: "years", width: 30 },
    { header: tr("Épreuves", "Events"), key: "disciplines", width: 34 },
    { header: tr("Meilleure place (finale)", "Best place (final)"), key: "bestFinalRank", width: 12 },
    { header: tr("Victoires", "Wins"), key: "wins", width: 9 },
    { header: "Podiums", key: "podiums", width: 9 },
  ];
  sheet.getRow(1).font = { bold: true };
  rows.forEach(({ entry, stats }) => {
    sheet.addRow({
      lastName: entry.lastName || "",
      firstName: entry.firstName || "",
      nationality: entry.nationality || "",
      gender: stats.gender,
      birth: entry.birthDate ? String(entry.birthDate).slice(0, 10) : stats.birthYear || "",
      waid: entry.waid || "",
      editionCount: stats.editionCount,
      years: stats.years.join(", "),
      disciplines: stats.disciplines.join(", "),
      bestFinalRank: stats.bestFinalRank ?? "",
      wins: stats.wins,
      podiums: stats.podiums,
    });
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `base-athletes-${new Date().toISOString().slice(0, 10)}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

function AthleteRegistryFilters({ state, totalCount, selectedCount, onClearSelection }) {
  const { filters, setFilter, resetFilters, hasFilters, options, filteredRows, sortKey, setSortKey } = state;
  const [exporting, setExporting] = useState(false);
  const tr = useTr();

  return (
    <div className="registry-filters">
      <div className="registry-filters__row">
        <label className="field registry-filters__search">
          <span>{tr("Recherche", "Search")}</span>
          <input
            value={filters.search}
            placeholder={tr("Nom, nationalité, WAID, année…", "Name, nationality, WAID, year…")}
            onChange={(event) => setFilter("search", event.target.value)}
          />
        </label>
        <label className="field">
          <span>{tr("Nationalité", "Nationality")}</span>
          <select value={filters.nationality} onChange={(event) => setFilter("nationality", event.target.value)}>
            <option value="">{tr("Toutes", "All")}</option>
            {options.nations.map((nation) => <option key={nation} value={nation}>{nation}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{tr("Genre", "Gender")}</span>
          <select value={filters.gender} onChange={(event) => setFilter("gender", event.target.value)}>
            <option value="">{tr("Tous", "All")}</option>
            <option value="W">{tr("Femmes", "Women")}</option>
            <option value="M">{tr("Hommes", "Men")}</option>
          </select>
        </label>
        <label className="field">
          <span>{tr("Épreuve", "Event")}</span>
          <select value={filters.discipline} onChange={(event) => setFilter("discipline", event.target.value)}>
            <option value="">{tr("Toutes", "All")}</option>
            {options.disciplines.map((discipline) => <option key={discipline} value={discipline}>{discipline}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{tr("A couru en", "Competed in")}</span>
          <select value={filters.year} onChange={(event) => setFilter("year", event.target.value)}>
            <option value="">{tr("Toutes les éditions", "All editions")}</option>
            {options.years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{tr("Éditions", "Editions")}</span>
          <select value={filters.minEditions} onChange={(event) => setFilter("minEditions", event.target.value)}>
            <option value="">{tr("Peu importe", "Any")}</option>
            <option value="2">{tr("2 ou plus", "2 or more")}</option>
            <option value="3">{tr("3 ou plus", "3 or more")}</option>
            <option value="5">{tr("5 ou plus", "5 or more")}</option>
          </select>
        </label>
        <label className="field">
          <span>WAID</span>
          <select value={filters.waid} onChange={(event) => setFilter("waid", event.target.value)}>
            <option value="">{tr("Peu importe", "Any")}</option>
            <option value="with">{tr("Avec WAID", "With WAID")}</option>
            <option value="without">{tr("Sans WAID", "Without WAID")}</option>
          </select>
        </label>
        <label className="field">
          <span>{tr("Trier par", "Sort by")}</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
            {REGISTRY_SORTS.map((sort) => <option key={sort.value} value={sort.value}>{tr(sort.label, sort.labelEn)}</option>)}
          </select>
        </label>
      </div>
      <div className="registry-filters__row registry-filters__row--meta">
        <span className="registry-filters__count">
          <strong>{filteredRows.length}</strong> {tr(`sur ${totalCount} fiches`, `of ${totalCount} profiles`)}
          {selectedCount ? ` · ${tr(`${selectedCount} sélectionnée${selectedCount > 1 ? "s" : ""}`, `${selectedCount} selected`)}` : ""}
        </span>
        {selectedCount ? (
          <button type="button" className="sheet-link" onClick={onClearSelection}>{tr("Vider la sélection", "Clear selection")}</button>
        ) : null}
        {hasFilters ? <button type="button" className="sheet-link" onClick={resetFilters}>{tr("Effacer les filtres", "Clear filters")}</button> : null}
        <button
          type="button"
          className="button button--secondary button--small registry-filters__export"
          disabled={exporting || !filteredRows.length}
          onClick={async () => {
            setExporting(true);
            try {
              await exportRegistryRows(state.sortedRows, tr);
            } finally {
              setExporting(false);
            }
          }}
        >
          {exporting ? tr("Export…", "Exporting…") : tr(`Exporter en Excel (${filteredRows.length})`, `Export to Excel (${filteredRows.length})`)}
        </button>
      </div>
    </div>
  );
}

const TABLE_COLUMNS = [
  { key: "name", label: "Nom", labelEn: "Last name" },
  { key: null, label: "Prénom", labelEn: "First name" },
  { key: "nationality", label: "Nat.", labelEn: "Nat." },
  { key: "birthYear", label: "Naissance", labelEn: "Birth" },
  { key: "editions", label: "Éd.", labelEn: "Ed." },
  { key: "firstYear", label: "1re", labelEn: "First" },
  { key: "lastYear", label: "Dernière", labelEn: "Last" },
  { key: null, label: "Épreuves", labelEn: "Events" },
  { key: "bestRank", label: "Meilleure place", labelEn: "Best place" },
  { key: "podiums", label: "Podiums", labelEn: "Podiums" },
  { key: null, label: "WAID", labelEn: "WAID" },
];

function AthleteRegistryTable({ state, selectedIds, onToggle, onOpen, openDocId }) {
  const { sortedRows, sortKey, sortDirection, changeSort } = state;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const tr = useTr();
  const visibleRows = sortedRows.slice(0, visibleCount);

  return (
    <>
      <div className="table-wrap table-wrap--sheet registry-table">
        <table className="data-table data-table--sheet">
          <thead>
            <tr>
              <th aria-label={tr("Sélection", "Selection")} />
              {TABLE_COLUMNS.map((column) => (
                <th key={column.label}>
                  {column.key ? (
                    <button type="button" className="registry-table__sort" onClick={() => changeSort(column.key)}>
                      {tr(column.label, column.labelEn)}
                      {sortKey === column.key ? <span aria-hidden="true">{sortDirection > 0 ? " ▲" : " ▼"}</span> : null}
                    </button>
                  ) : tr(column.label, column.labelEn)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ entry, stats }) => (
              <tr key={entry._docId} className={openDocId === entry._docId ? "registry-table__row--open" : ""}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(entry._docId)}
                    onChange={() => onToggle(entry._docId)}
                    aria-label={tr(`Sélectionner ${formatName(entry)}`, `Select ${formatName(entry)}`)}
                  />
                </td>
                <td className="sheet-name">
                  <button type="button" className="sheet-link" onClick={() => onOpen(entry._docId)} title={tr("Ouvrir la fiche", "Open the profile")}>
                    {entry.lastName || "—"}
                  </button>
                </td>
                <td>{entry.firstName || "—"}</td>
                <td className="sheet-nowrap">{entry.nationality || "—"}</td>
                <td className="sheet-nowrap sheet-muted">
                  {entry.birthDate ? String(entry.birthDate).slice(0, 10) : stats.birthYear || "—"}
                </td>
                <td className="registry-table__num">{stats.editionCount || "—"}</td>
                <td className="registry-table__num">{stats.firstYear || "—"}</td>
                <td className="registry-table__num">{stats.lastYear || "—"}</td>
                <td className="sheet-ellipsis sheet-muted" title={stats.disciplines.join(", ")}>
                  {stats.disciplines.join(", ") || "—"}
                </td>
                <td className="registry-table__num">{stats.bestFinalRank || "—"}</td>
                <td className="registry-table__num">{stats.podiums || "—"}</td>
                <td className="sheet-nowrap">
                  {entry.waUrl ? (
                    <a href={entry.waUrl} target="_blank" rel="noopener noreferrer">{entry.waid || "WA"} ↗</a>
                  ) : entry.waid || <span className="sheet-muted">—</span>}
                </td>
              </tr>
            ))}
            {!visibleRows.length ? (
              <tr>
                <td colSpan={TABLE_COLUMNS.length + 1} className="table-empty-state">{tr("Aucune fiche ne correspond aux filtres.", "No profile matches the filters.")}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {sortedRows.length > visibleCount ? (
        <div className="list-progressive-actions">
          <button type="button" className="button button--secondary button--small" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
            {tr(`Afficher ${Math.min(PAGE_SIZE, sortedRows.length - visibleCount)} de plus`, `Show ${Math.min(PAGE_SIZE, sortedRows.length - visibleCount)} more`)}
          </button>
          <button type="button" className="sheet-link" onClick={() => setVisibleCount(sortedRows.length)}>
            {tr(`Tout afficher (${sortedRows.length})`, `Show all (${sortedRows.length})`)}
          </button>
        </div>
      ) : null}
    </>
  );
}

function BarList({ items, max, formatLabel = (label) => label, limit = 12 }) {
  const top = items.slice(0, limit);
  const scale = max || Math.max(1, ...top.map(([, count]) => count));
  return (
    <ul className="registry-bars">
      {top.map(([label, count]) => (
        <li key={label}>
          <span className="registry-bars__label" title={formatLabel(label)}>{formatLabel(label)}</span>
          <span className="registry-bars__track"><span style={{ width: `${(count / scale) * 100}%` }} /></span>
          <span className="registry-bars__value">{count}</span>
        </li>
      ))}
      {!top.length ? <li className="sheet-muted">—</li> : null}
    </ul>
  );
}

function AthleteRegistryAnalysisPanel(props) {
  const { Panel, rows, hasFilters, onOpen } = props;
  const analysis = useMemo(() => buildRegistryAnalysis(rows), [rows]);
  const maxPerYear = Math.max(1, ...analysis.perYear.map((item) => item.athletes));
  const pct = (value) => (analysis.total ? Math.round((value / analysis.total) * 100) : 0);
  const tr = useTr();
  const genderLabel = { W: tr("Femmes", "Women"), M: tr("Hommes", "Men") };

  return (
    <Panel
      title={tr("Analyse", "Analysis")}
      subtitle={hasFilters
        ? tr(`Calculée sur les ${analysis.total} fiches filtrées`, `Based on the ${analysis.total} filtered profiles`)
        : tr(`Toute la base : ${analysis.total} fiches`, `Whole database: ${analysis.total} profiles`)}
    >
      <div className="registry-kpis">
        <div><strong>{analysis.total}</strong><span>{tr("athlètes", "athletes")}</span></div>
        <div><strong>{analysis.participations}</strong><span>participations</span></div>
        <div><strong>{analysis.nations.length}</strong><span>nations</span></div>
        <div><strong>{pct(analysis.returning)} %</strong><span>{tr("revenus au moins 2 fois", "came back at least twice")}</span></div>
        <div><strong>{pct(analysis.withWaid)} %</strong><span>{tr("avec WAID", "with WAID")}</span></div>
      </div>

      <div className="registry-analysis">
        <section className="registry-analysis__wide">
          <h4>{tr("Athlètes par édition", "Athletes per edition")} <small>{tr("(dont nouveaux)", "(incl. newcomers)")}</small></h4>
          <div className="registry-years">
            {analysis.perYear.map((item) => (
              <div
                key={item.year}
                className="registry-years__col"
                title={tr(
                  `${item.year} : ${item.athletes} athlètes, dont ${item.newcomers} nouveaux`,
                  `${item.year}: ${item.athletes} athletes, incl. ${item.newcomers} newcomers`,
                )}
              >
                <span className="registry-years__value">{item.athletes}</span>
                <span className="registry-years__bar" style={{ height: `${(item.athletes / maxPerYear) * 100}%` }}>
                  <span style={{ height: `${item.athletes ? (item.newcomers / item.athletes) * 100 : 0}%` }} />
                </span>
                <span className="registry-years__label">{String(item.year).slice(2)}</span>
              </div>
            ))}
          </div>
          <p className="registry-legend"><i className="registry-legend__all" /> {tr("athlètes", "athletes")} · <i className="registry-legend__new" /> {tr("première participation", "first participation")}</p>
        </section>
        <section>
          <h4>Nations</h4>
          <BarList items={analysis.nations} />
        </section>
        <section>
          <h4>{tr("Épreuves", "Events")} <small>{tr("(athlètes)", "(athletes)")}</small></h4>
          <BarList items={analysis.disciplines} />
        </section>
        <section>
          <h4>{tr("Fidélité", "Loyalty")} <small>{tr("(nombre d'éditions)", "(number of editions)")}</small></h4>
          <BarList
            items={["1", "2", "3", "4", "5+"].map((key) => [key, analysis.loyalty.find(([label]) => label === key)?.[1] || 0])}
            formatLabel={(label) => (label === "1" ? tr("1 édition", "1 edition") : tr(`${label} éditions`, `${label} editions`))}
          />
          <h4>{tr("Genre", "Gender")}</h4>
          <BarList items={analysis.genders} formatLabel={(label) => genderLabel[label] || label} />
        </section>
        <section>
          <h4>{tr("Les plus fidèles", "Most loyal")}</h4>
          <ol className="registry-top">
            {analysis.mostLoyal.map(({ entry, stats }) => (
              <li key={entry._docId}>
                <button type="button" className="sheet-link" onClick={() => onOpen(entry._docId)}>{formatName(entry)}</button>
                <span className="sheet-muted"> {entry.nationality} · {stats.editionCount} {tr("éd.", "ed.")} ({stats.firstYear}–{stats.lastYear})</span>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h4>{tr("Le plus de podiums en finale", "Most podiums in finals")}</h4>
          <ol className="registry-top">
            {analysis.mostPodiums.map(({ entry, stats }) => (
              <li key={entry._docId}>
                <button type="button" className="sheet-link" onClick={() => onOpen(entry._docId)}>{formatName(entry)}</button>
                <span className="sheet-muted"> {entry.nationality} · {stats.podiums} podium{stats.podiums > 1 ? "s" : ""}{stats.wins ? tr(`, ${stats.wins} victoire${stats.wins > 1 ? "s" : ""}`, `, ${stats.wins} win${stats.wins > 1 ? "s" : ""}`) : ""}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Panel>
  );
}

function AthleteRegistryCleanupPanel(props) {
  const { Panel, rows, getLinkedCount, onOpen, onDelete, deleting, status } = props;
  const [selected, setSelected] = useState([]);
  const [visibleCount, setVisibleCount] = useState(50);
  const tr = useTr();
  const selectedRows = rows.filter(({ entry }) => selected.includes(entry._docId));

  function toggle(docId) {
    setSelected((current) => (current.includes(docId) ? current.filter((id) => id !== docId) : [...current, docId]));
  }

  return (
    <Panel
      title={tr(`À nettoyer (${rows.length})`, `To clean up (${rows.length})`)}
      subtitle={tr(
        "Fiches dont le nom ressemble à une épreuve, contient des chiffres, est vide ou incomplet. Corrige le nom dans la fiche, fusionne-la avec la bonne personne, ou supprime-la.",
        "Profiles whose name looks like an event, contains digits, is empty or incomplete. Fix the name in the profile, merge it with the right person, or delete it.",
      )}
    >
      {status ? <p className="panel-note" style={{ marginTop: 0 }}>{status}</p> : null}
      {!rows.length ? (
        <p className="panel-note" style={{ margin: 0 }}>{tr("Aucune fiche suspecte : la base est propre.", "No suspicious profile: the database is clean.")}</p>
      ) : (
        <>
          <div className="table-wrap table-wrap--sheet">
            <table className="data-table data-table--sheet">
              <thead>
                <tr>
                  <th aria-label={tr("Sélection", "Selection")} />
                  <th>{tr("Nom", "Last name")}</th>
                  <th>{tr("Prénom", "First name")}</th>
                  <th>Nat.</th>
                  <th>{tr("Éditions", "Editions")}</th>
                  <th>{tr("Pourquoi", "Why")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, visibleCount).map(({ entry, stats, suspectReasons }) => {
                  const linked = getLinkedCount(entry._docId);
                  return (
                    <tr key={entry._docId}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(entry._docId)}
                          onChange={() => toggle(entry._docId)}
                          aria-label={tr(`Sélectionner ${formatName(entry)}`, `Select ${formatName(entry)}`)}
                        />
                      </td>
                      <td className="sheet-name">{entry.lastName || <span className="sheet-muted">{tr("(vide)", "(empty)")}</span>}</td>
                      <td>{entry.firstName || <span className="sheet-muted">{tr("(vide)", "(empty)")}</span>}</td>
                      <td>{entry.nationality || "—"}</td>
                      <td className="sheet-nowrap">{stats.years.join(", ") || "—"}</td>
                      <td>
                        {suspectReasons.map((reason) => <span key={reason} className="registry-flag">{registrySuspectReasonLabel(reason, tr)}</span>)}
                        {linked ? (
                          <span className="registry-flag registry-flag--info">
                            {tr(`${linked} engagé${linked > 1 ? "s" : ""} lié${linked > 1 ? "s" : ""}`, `${linked} linked entr${linked > 1 ? "ies" : "y"}`)}
                          </span>
                        ) : null}
                      </td>
                      <td className="sheet-nowrap sheet-actions">
                        <button type="button" onClick={() => onOpen(entry._docId)}>{tr("Ouvrir / corriger", "Open / fix")}</button>
                        {linked ? (
                          <button
                            type="button"
                            className="sheet-actions__danger"
                            disabled={deleting}
                            title={tr(
                              "Supprime la fiche et la ligne d'engagé liée de l'édition en cours (à utiliser si cet engagé est lui aussi une erreur d'import)",
                              "Deletes the profile and the linked entry of the current edition (use it if that entry is also an import error)",
                            )}
                            onClick={() => onDelete([entry], { withLinkedEntries: true })}
                          >
                            {tr("Supprimer avec l'engagé", "Delete with the entry")}
                          </button>
                        ) : (
                          <button type="button" className="sheet-actions__danger" disabled={deleting} onClick={() => onDelete([entry])}>
                            {tr("Supprimer", "Delete")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-actions table-actions--inline">
            {rows.length > visibleCount ? (
              <button type="button" className="button button--secondary button--small" onClick={() => setVisibleCount((count) => count + 50)}>
                {tr("Afficher 50 de plus", "Show 50 more")}
              </button>
            ) : null}
            <button type="button" className="sheet-link" onClick={() => setSelected(rows.map(({ entry }) => entry._docId))}>
              {tr("Tout sélectionner", "Select all")}
            </button>
            <button
              type="button"
              className="button button--danger button--small"
              disabled={!selectedRows.length || deleting}
              onClick={async () => {
                const done = await onDelete(selectedRows.map(({ entry }) => entry));
                if (done) setSelected([]);
              }}
            >
              {deleting ? tr("Suppression…", "Deleting…") : tr(`Supprimer la sélection (${selectedRows.length})`, `Delete selection (${selectedRows.length})`)}
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}

export {
  AthleteRegistryAnalysisPanel,
  AthleteRegistryCleanupPanel,
  AthleteRegistryFilters,
  AthleteRegistryTable,
};
