import { useMemo, useState } from "react";
import { REGISTRY_SORTS, buildRegistryAnalysis } from "./athlete-registry-analysis";

// Outils de la page Base athlètes : filtres + tri, tableau paginé, analyse
// statistique et liste des fiches à nettoyer.

const PAGE_SIZE = 100;

function formatName(entry) {
  return [entry.firstName, entry.lastName].filter(Boolean).join(" ") || "—";
}

async function exportRegistryRows(rows) {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Base athlètes");
  sheet.columns = [
    { header: "Nom", key: "lastName", width: 22 },
    { header: "Prénom", key: "firstName", width: 18 },
    { header: "Nationalité", key: "nationality", width: 11 },
    { header: "Genre", key: "gender", width: 7 },
    { header: "Naissance", key: "birth", width: 12 },
    { header: "WAID", key: "waid", width: 12 },
    { header: "Nb éditions", key: "editionCount", width: 11 },
    { header: "Éditions", key: "years", width: 30 },
    { header: "Épreuves", key: "disciplines", width: 34 },
    { header: "Meilleure place (finale)", key: "bestFinalRank", width: 12 },
    { header: "Victoires", key: "wins", width: 9 },
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

  return (
    <div className="registry-filters">
      <div className="registry-filters__row">
        <label className="field registry-filters__search">
          <span>Recherche</span>
          <input
            value={filters.search}
            placeholder="Nom, nationalité, WAID, année…"
            onChange={(event) => setFilter("search", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Nationalité</span>
          <select value={filters.nationality} onChange={(event) => setFilter("nationality", event.target.value)}>
            <option value="">Toutes</option>
            {options.nations.map((nation) => <option key={nation} value={nation}>{nation}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Genre</span>
          <select value={filters.gender} onChange={(event) => setFilter("gender", event.target.value)}>
            <option value="">Tous</option>
            <option value="W">Femmes</option>
            <option value="M">Hommes</option>
          </select>
        </label>
        <label className="field">
          <span>Épreuve</span>
          <select value={filters.discipline} onChange={(event) => setFilter("discipline", event.target.value)}>
            <option value="">Toutes</option>
            {options.disciplines.map((discipline) => <option key={discipline} value={discipline}>{discipline}</option>)}
          </select>
        </label>
        <label className="field">
          <span>A couru en</span>
          <select value={filters.year} onChange={(event) => setFilter("year", event.target.value)}>
            <option value="">Toutes les éditions</option>
            {options.years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Éditions</span>
          <select value={filters.minEditions} onChange={(event) => setFilter("minEditions", event.target.value)}>
            <option value="">Peu importe</option>
            <option value="2">2 ou plus</option>
            <option value="3">3 ou plus</option>
            <option value="5">5 ou plus</option>
          </select>
        </label>
        <label className="field">
          <span>WAID</span>
          <select value={filters.waid} onChange={(event) => setFilter("waid", event.target.value)}>
            <option value="">Peu importe</option>
            <option value="with">Avec WAID</option>
            <option value="without">Sans WAID</option>
          </select>
        </label>
        <label className="field">
          <span>Trier par</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
            {REGISTRY_SORTS.map((sort) => <option key={sort.value} value={sort.value}>{sort.label}</option>)}
          </select>
        </label>
      </div>
      <div className="registry-filters__row registry-filters__row--meta">
        <span className="registry-filters__count">
          <strong>{filteredRows.length}</strong> sur {totalCount} fiches
          {selectedCount ? ` · ${selectedCount} sélectionnée${selectedCount > 1 ? "s" : ""}` : ""}
        </span>
        {selectedCount ? (
          <button type="button" className="sheet-link" onClick={onClearSelection}>Vider la sélection</button>
        ) : null}
        {hasFilters ? <button type="button" className="sheet-link" onClick={resetFilters}>Effacer les filtres</button> : null}
        <button
          type="button"
          className="button button--secondary button--small registry-filters__export"
          disabled={exporting || !filteredRows.length}
          onClick={async () => {
            setExporting(true);
            try {
              await exportRegistryRows(state.sortedRows);
            } finally {
              setExporting(false);
            }
          }}
        >
          {exporting ? "Export…" : `Exporter en Excel (${filteredRows.length})`}
        </button>
      </div>
    </div>
  );
}

const TABLE_COLUMNS = [
  { key: "name", label: "Nom" },
  { key: null, label: "Prénom" },
  { key: "nationality", label: "Nat." },
  { key: "birthYear", label: "Naissance" },
  { key: "editions", label: "Éd." },
  { key: "firstYear", label: "1re" },
  { key: "lastYear", label: "Dernière" },
  { key: null, label: "Épreuves" },
  { key: "bestRank", label: "Meilleure place" },
  { key: "podiums", label: "Podiums" },
  { key: null, label: "WAID" },
];

function AthleteRegistryTable({ state, selectedIds, onToggle, onOpen, openDocId }) {
  const { sortedRows, sortKey, sortDirection, changeSort } = state;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visibleRows = sortedRows.slice(0, visibleCount);

  return (
    <>
      <div className="table-wrap table-wrap--sheet registry-table">
        <table className="data-table data-table--sheet">
          <thead>
            <tr>
              <th aria-label="Sélection" />
              {TABLE_COLUMNS.map((column) => (
                <th key={column.label}>
                  {column.key ? (
                    <button type="button" className="registry-table__sort" onClick={() => changeSort(column.key)}>
                      {column.label}
                      {sortKey === column.key ? <span aria-hidden="true">{sortDirection > 0 ? " ▲" : " ▼"}</span> : null}
                    </button>
                  ) : column.label}
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
                    aria-label={`Sélectionner ${formatName(entry)}`}
                  />
                </td>
                <td className="sheet-name">
                  <button type="button" className="sheet-link" onClick={() => onOpen(entry._docId)} title="Ouvrir la fiche">
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
                <td colSpan={TABLE_COLUMNS.length + 1} className="table-empty-state">Aucune fiche ne correspond aux filtres.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {sortedRows.length > visibleCount ? (
        <div className="list-progressive-actions">
          <button type="button" className="button button--secondary button--small" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
            Afficher {Math.min(PAGE_SIZE, sortedRows.length - visibleCount)} de plus
          </button>
          <button type="button" className="sheet-link" onClick={() => setVisibleCount(sortedRows.length)}>
            Tout afficher ({sortedRows.length})
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
  const genderLabel = { W: "Femmes", M: "Hommes" };

  return (
    <Panel
      title="Analyse"
      subtitle={hasFilters ? `Calculée sur les ${analysis.total} fiches filtrées` : `Toute la base : ${analysis.total} fiches`}
    >
      <div className="registry-kpis">
        <div><strong>{analysis.total}</strong><span>athlètes</span></div>
        <div><strong>{analysis.participations}</strong><span>participations</span></div>
        <div><strong>{analysis.nations.length}</strong><span>nations</span></div>
        <div><strong>{pct(analysis.returning)} %</strong><span>revenus au moins 2 fois</span></div>
        <div><strong>{pct(analysis.withWaid)} %</strong><span>avec WAID</span></div>
      </div>

      <div className="registry-analysis">
        <section className="registry-analysis__wide">
          <h4>Athlètes par édition <small>(dont nouveaux)</small></h4>
          <div className="registry-years">
            {analysis.perYear.map((item) => (
              <div key={item.year} className="registry-years__col" title={`${item.year} : ${item.athletes} athlètes, dont ${item.newcomers} nouveaux`}>
                <span className="registry-years__value">{item.athletes}</span>
                <span className="registry-years__bar" style={{ height: `${(item.athletes / maxPerYear) * 100}%` }}>
                  <span style={{ height: `${item.athletes ? (item.newcomers / item.athletes) * 100 : 0}%` }} />
                </span>
                <span className="registry-years__label">{String(item.year).slice(2)}</span>
              </div>
            ))}
          </div>
          <p className="registry-legend"><i className="registry-legend__all" /> athlètes · <i className="registry-legend__new" /> première participation</p>
        </section>
        <section>
          <h4>Nations</h4>
          <BarList items={analysis.nations} />
        </section>
        <section>
          <h4>Épreuves <small>(athlètes)</small></h4>
          <BarList items={analysis.disciplines} />
        </section>
        <section>
          <h4>Fidélité <small>(nombre d'éditions)</small></h4>
          <BarList
            items={["1", "2", "3", "4", "5+"].map((key) => [key, analysis.loyalty.find(([label]) => label === key)?.[1] || 0])}
            formatLabel={(label) => (label === "1" ? "1 édition" : `${label} éditions`)}
          />
          <h4>Genre</h4>
          <BarList items={analysis.genders} formatLabel={(label) => genderLabel[label] || label} />
        </section>
        <section>
          <h4>Les plus fidèles</h4>
          <ol className="registry-top">
            {analysis.mostLoyal.map(({ entry, stats }) => (
              <li key={entry._docId}>
                <button type="button" className="sheet-link" onClick={() => onOpen(entry._docId)}>{formatName(entry)}</button>
                <span className="sheet-muted"> {entry.nationality} · {stats.editionCount} éd. ({stats.firstYear}–{stats.lastYear})</span>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h4>Le plus de podiums en finale</h4>
          <ol className="registry-top">
            {analysis.mostPodiums.map(({ entry, stats }) => (
              <li key={entry._docId}>
                <button type="button" className="sheet-link" onClick={() => onOpen(entry._docId)}>{formatName(entry)}</button>
                <span className="sheet-muted"> {entry.nationality} · {stats.podiums} podium{stats.podiums > 1 ? "s" : ""}{stats.wins ? `, ${stats.wins} victoire${stats.wins > 1 ? "s" : ""}` : ""}</span>
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
  const selectedRows = rows.filter(({ entry }) => selected.includes(entry._docId));

  function toggle(docId) {
    setSelected((current) => (current.includes(docId) ? current.filter((id) => id !== docId) : [...current, docId]));
  }

  return (
    <Panel
      title={`À nettoyer (${rows.length})`}
      subtitle="Fiches dont le nom ressemble à une épreuve, contient des chiffres, est vide ou incomplet. Corrige le nom dans la fiche, fusionne-la avec la bonne personne, ou supprime-la."
    >
      {status ? <p className="panel-note" style={{ marginTop: 0 }}>{status}</p> : null}
      {!rows.length ? (
        <p className="panel-note" style={{ margin: 0 }}>Aucune fiche suspecte : la base est propre.</p>
      ) : (
        <>
          <div className="table-wrap table-wrap--sheet">
            <table className="data-table data-table--sheet">
              <thead>
                <tr>
                  <th aria-label="Sélection" />
                  <th>Nom</th>
                  <th>Prénom</th>
                  <th>Nat.</th>
                  <th>Éditions</th>
                  <th>Pourquoi</th>
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
                          aria-label={`Sélectionner ${formatName(entry)}`}
                        />
                      </td>
                      <td className="sheet-name">{entry.lastName || <span className="sheet-muted">(vide)</span>}</td>
                      <td>{entry.firstName || <span className="sheet-muted">(vide)</span>}</td>
                      <td>{entry.nationality || "—"}</td>
                      <td className="sheet-nowrap">{stats.years.join(", ") || "—"}</td>
                      <td>
                        {suspectReasons.map((reason) => <span key={reason} className="registry-flag">{reason}</span>)}
                        {linked ? <span className="registry-flag registry-flag--info">{linked} engagé{linked > 1 ? "s" : ""} lié{linked > 1 ? "s" : ""}</span> : null}
                      </td>
                      <td className="sheet-nowrap sheet-actions">
                        <button type="button" onClick={() => onOpen(entry._docId)}>Ouvrir / corriger</button>
                        {linked ? (
                          <button
                            type="button"
                            className="sheet-actions__danger"
                            disabled={deleting}
                            title="Supprime la fiche et la ligne d'engagé liée de l'édition en cours (à utiliser si cet engagé est lui aussi une erreur d'import)"
                            onClick={() => onDelete([entry], { withLinkedEntries: true })}
                          >
                            Supprimer avec l&apos;engagé
                          </button>
                        ) : (
                          <button type="button" className="sheet-actions__danger" disabled={deleting} onClick={() => onDelete([entry])}>
                            Supprimer
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
                Afficher 50 de plus
              </button>
            ) : null}
            <button type="button" className="sheet-link" onClick={() => setSelected(rows.map(({ entry }) => entry._docId))}>
              Tout sélectionner
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
              {deleting ? "Suppression…" : `Supprimer la sélection (${selectedRows.length})`}
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
