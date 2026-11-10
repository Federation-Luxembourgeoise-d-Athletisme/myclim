import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate, useOutletContext } from "react-router-dom";
import { useAllMeetingResults, useMeetingEditions } from "./meeting-history-hooks";
import { buildSearchIndex, eventAnchorId, searchStatistics } from "./statistics-compute";
import { useStatisticsEdition } from "./statistics-edition";

/**
 * Module Statistiques (/app/resultats) : une seule barre en haut avec
 *  - l'édition affichée, gardée dans l'adresse (?edition=2026, absente =
 *    toutes les éditions) et donc partagée par tous les onglets ;
 *  - une recherche qui mène directement à un athlète, une épreuve ou une année ;
 *  - les onglets.
 * Les pages des onglets lisent l'édition via useStatisticsEdition() (statistics-edition.js).
 */

const BASE = "/app/resultats";

const STATISTICS_TABS = [
  { to: BASE, end: true, label: "Vue d'ensemble" },
  { to: `${BASE}/editions`, label: "Résultats" },
  { to: `${BASE}/records`, label: "Records", scope: "tous temps" },
  { to: `${BASE}/hall-of-winners`, label: "Palmarès", scope: "tous temps" },
  { to: `${BASE}/base-athletes`, label: "Athlètes" },
];

function StatisticsSearch({ editions, onPickYear }) {
  const navigate = useNavigate();
  const { results, loading } = useAllMeetingResults();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const index = useMemo(() => buildSearchIndex({ results, editions }), [results, editions]);
  const found = useMemo(() => searchStatistics(index, query), [index, query]);
  const hasResults = found.athletes.length + found.events.length + found.years.length > 0;

  useEffect(() => {
    function onDocClick(event) {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function done() {
    setQuery("");
    setOpen(false);
  }

  function pickAthlete(athlete) {
    done();
    navigate(`${BASE}/base-athletes?recherche=${encodeURIComponent(athlete.lastName || athlete.name)}`);
  }

  function pickEvent(event) {
    done();
    const year = event.years[0];
    navigate(`${BASE}/editions?edition=${year}#${eventAnchorId(event.discipline, event.gender)}`);
  }

  function pickYear(year) {
    done();
    onPickYear(year);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") done();
    if (event.key === "Enter") {
      if (found.athletes[0]) pickAthlete(found.athletes[0]);
      else if (found.events[0]) pickEvent(found.events[0]);
      else if (found.years[0]) pickYear(found.years[0]);
    }
  }

  return (
    <div className="stats-search" ref={boxRef}>
      <input
        type="search"
        value={query}
        placeholder="Athlète, épreuve, pays ou année…"
        aria-label="Rechercher dans les statistiques"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && query.trim() ? (
        <div className="stats-search__menu" role="listbox">
          {loading ? <p className="stats-search__empty">Chargement de l&apos;historique…</p> : null}
          {!loading && !hasResults ? <p className="stats-search__empty">Aucun résultat</p> : null}
          {found.athletes.length ? <p className="stats-search__group">Athlètes</p> : null}
          {found.athletes.map((a) => (
            <button key={`a-${a.name}-${a.noc}`} type="button" onClick={() => pickAthlete(a)}>
              <span>{a.name} <small className="stats-search__noc">{a.noc}</small></span>
              <small>{a.years.length > 1 ? `${a.years.length} éditions` : a.years[0]}</small>
            </button>
          ))}
          {found.events.length ? <p className="stats-search__group">Épreuves</p> : null}
          {found.events.map((e) => (
            <button key={`e-${e.discipline}-${e.gender}`} type="button" onClick={() => pickEvent(e)}>
              <span>{e.label}</span>
              <small>résultats {e.years[0]}</small>
            </button>
          ))}
          {found.years.length ? <p className="stats-search__group">Éditions</p> : null}
          {found.years.map((y) => (
            <button key={`y-${y}`} type="button" onClick={() => pickYear(y)}>
              <span>Édition {y}</span>
              <small>vue d&apos;ensemble</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatisticsLayout() {
  const outletContext = useOutletContext();
  const navigate = useNavigate();
  const { edition, setEdition } = useStatisticsEdition();
  const { editions } = useMeetingEditions();
  const years = useMemo(
    () => editions.filter((e) => !e.cancelled).map((e) => Number(e.year)).sort((a, b) => b - a),
    [editions],
  );
  const position = edition ? years.indexOf(edition) : -1;
  // Les onglets ne gardent que l'édition (pas ?recherche= de la base athlètes).
  const search = edition ? `?edition=${edition}` : "";

  function pickYearFromSearch(year) {
    // Une année cherchée ouvre la vue d'ensemble de cette édition.
    navigate(`${BASE}?edition=${year}`);
  }

  return (
    <div className="page tabbed-page stats-layout">
      <section className="page-header tabbed-page__header">
        <div>
          <p className="eyebrow">Athlètes</p>
          <h1>Statistiques</h1>
        </div>
      </section>

      <div className="stats-bar">
        <div className="stats-edition" title="Édition affichée — gardée en changeant d'onglet">
          <button
            type="button"
            aria-label="Édition précédente"
            disabled={!edition || position >= years.length - 1}
            onClick={() => setEdition(years[position + 1])}
          >‹</button>
          <select
            value={edition ?? ""}
            onChange={(e) => setEdition(e.target.value ? Number(e.target.value) : null)}
            aria-label="Édition"
          >
            <option value="">Toutes les éditions</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            type="button"
            aria-label="Édition suivante"
            disabled={!edition || position <= 0}
            onClick={() => setEdition(years[position - 1])}
          >›</button>
        </div>
        <StatisticsSearch editions={editions} onPickYear={pickYearFromSearch} />
      </div>

      <nav className="stats-tabs" aria-label="Statistiques">
        {STATISTICS_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={`${tab.to}${search}`}
            end={tab.end}
            className={({ isActive }) => `stats-tabs__tab${isActive ? " stats-tabs__tab--active" : ""}`}
          >
            {tab.label}
            {tab.scope ? <span className="stats-tabs__scope">{tab.scope}</span> : null}
          </NavLink>
        ))}
      </nav>

      <div className="tabbed-page__body">
        <Outlet context={outletContext} />
      </div>
    </div>
  );
}

export { StatisticsLayout };
