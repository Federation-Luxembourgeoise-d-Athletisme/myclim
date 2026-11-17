import { useMemo } from "react";
import { NavLink, Outlet, useOutletContext, useSearchParams } from "react-router-dom";
import { useStatisticsEdition } from "./statistics-edition";
import { formatPersonName } from "./statistics-compute";
import { CopyButton, LevelBadge, NoEntries } from "./statistics-levels-page";
import { useSpeakerData } from "./statistics-levels-hooks";
import { useTr } from "./use-tr";

/**
 * Module Animation (/app/animation) : pour les speakers (équipe « Speakers
 * (Athle.ch) ») et toute équipe de l'organisation qui a le module, plus les
 * rôles des Statistiques. Lecture seule : rien sur les voyages ni les contacts.
 *  - L'édition en direct : chiffres calculés sur les engagés ;
 *  - Fiches par épreuve, dans l'ordre du programme horaire ;
 *  - Par niveau : sans label / Bronze / Silver.
 * L'édition affichée suit ?edition= (sinon l'édition active).
 */

const BASE = "/app/animation";

function AnimationLayout() {
  const tr = useTr();
  const outletContext = useOutletContext();
  const { edition } = useStatisticsEdition();
  const [, setSearchParams] = useSearchParams();
  const { year, editions, isExample } = useSpeakerData();
  const years = useMemo(
    () => [...new Set(editions.filter((e) => !e.cancelled).map((e) => Number(e.year ?? e.id)).filter(Boolean))].sort((a, b) => b - a),
    [editions],
  );
  const search = isExample ? "?exemple=1" : edition ? `?edition=${edition}` : "";

  function pickEdition(value) {
    setSearchParams(value === "exemple" ? { exemple: "1" } : value ? { edition: value } : {}, { replace: true });
  }
  const tabs = [
    { to: BASE, end: true, label: tr(`L'édition ${year}`, `The ${year} edition`) },
    { to: `${BASE}/fiches`, label: tr("Fiches par épreuve", "Event sheets") },
    { to: `${BASE}/niveaux`, label: tr("Par niveau", "By level") },
  ];

  return (
    <div className="page tabbed-page stats-layout animation-layout">
      <section className="page-header tabbed-page__header">
        <div>
          <p className="eyebrow">Animation</p>
          <h1>{tr("Fiches speaker & chiffres", "Speaker sheets & figures")}</h1>
        </div>
      </section>

      <div className="stats-bar">
        <div className="stats-edition">
          <select
            value={isExample ? "exemple" : edition ?? ""}
            onChange={(e) => pickEdition(e.target.value)}
            aria-label={tr("Édition", "Edition")}
          >
            <option value="">{tr("Édition en préparation", "Edition in preparation")}</option>
            <option value="exemple">{tr("Exemple 2026 (engagés de démo)", "Example 2026 (demo entries)")}</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <p className="stats-muted animation-layout__note">
          {tr(
            "Lecture seule. Noms, nations, épreuves et performances uniquement.",
            "Read only. Names, nations, events and marks only.",
          )}
        </p>
      </div>

      <nav className="stats-tabs" aria-label="Animation">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={`${tab.to}${search}`}
            end={tab.end}
            className={({ isActive }) => `stats-tabs__tab${isActive ? " stats-tabs__tab--active" : ""}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="tabbed-page__body">
        <Outlet context={outletContext} />
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div className="stats-kpi">
      <div className="stats-kpi__label">{label}</div>
      <div className="stats-kpi__value">{value}</div>
      {sub ? <div className="stats-kpi__sub">{sub}</div> : null}
    </div>
  );
}

function AnimationEditionPage() {
  const tr = useTr();
  const { year, data, loading, error } = useSpeakerData();
  const live = data?.live;

  if (error) return <div className="notice-card notice-card--warn"><strong>{tr("Erreur de chargement", "Loading error")}</strong><p>{error}</p></div>;
  if (loading || !live) return <p className="panel-note">{tr("Chargement des engagés et de l'historique…", "Loading the entries and the history…")}</p>;
  if (!live.athletes) return <NoEntries year={year} />;

  const versus = (key) => (live.previous ? tr(`${live.previous[key]} en ${live.previous.year}`, `${live.previous[key]} in ${live.previous.year}`) : "");

  return (
    <div className="animation-edition">
      <p className="stats-muted stats-small" style={{ marginTop: 0 }}>
        {tr(`Édition ${year}`, `${year} edition`)} <LevelBadge level={data.level} /> ·{" "}
        {tr(
          "calculé sur les engagés actuels (sans les « out » ni les lièvres) : les chiffres bougent à chaque import.",
          "computed on the current entries (without “out” and pacers): the figures move with every import.",
        )}
      </p>
      <div className="stats-kpis">
        <Kpi label={tr("Athlètes engagés", "Athletes entered")} value={live.athletes} sub={versus("athletes")} />
        <Kpi label="Nations" value={live.nations} sub={versus("nations")} />
        <Kpi label={tr("Nouvelles nations", "New nations")} value={live.firstTimeNations.length} sub={live.firstTimeNations.join(", ") || tr("jamais venues avant", "never came before")} />
        <Kpi label={tr("Découvrent le meeting", "New to the meeting")} value={live.newcomers} sub={tr(`${live.returning} déjà venus`, `${live.returning} came before`)} />
        <Kpi label={tr("Records menacés", "Records under threat")} value={live.threats.length} sub={tr("PB > record du meeting", "PB beats meeting record")} />
        <Kpi label={tr("Femmes / hommes", "Women / men")} value={`${live.women} / ${live.men}`} sub={tr(`${live.events} épreuves`, `${live.events} events`)} />
      </div>

      <div className="stats-cols">
        <section className="stats-box">
          <header className="stats-box__head"><h2>{tr("Informations clés", "Key information")}</h2></header>
          {live.facts.map((fact) => (
            <div key={fact.text} className="stats-fact">
              <div>
                <div className="stats-fact__category">{fact.category}</div>
                {fact.text}
              </div>
              <CopyButton text={fact.text} />
            </div>
          ))}
        </section>
        <section className="stats-box">
          <header className="stats-box__head"><h2>{tr("À suivre", "One to watch")}</h2></header>
          {live.champions.map((e) => (
            <div key={`c-${e.athlete.id}`} className="stats-row">
              <span className="stats-row__label">{tr("Tenant du titre", "Defending champion")}</span>
              <span>{formatPersonName(e.athlete)} ({e.athlete.nationality}) · {e.sheet.label}</span>
              <span className="stats-row__value">{e.athlete.pbIndoor || e.athlete.pb || e.athlete.waPbIndoor ? `PB ${e.athlete.pbIndoor || e.athlete.pb || e.athlete.waPbIndoor}` : ""}</span>
            </div>
          ))}
          {live.threats.map((e) => (
            <div key={`t-${e.athlete.id}`} className="stats-row">
              <span className="stats-row__label">{tr("Record possible", "Record possible")}</span>
              <span>{formatPersonName(e.athlete)} ({e.athlete.nationality}) · {e.sheet.label} <small className="stats-muted">MR {e.sheet.record?.mark}</small></span>
              <span className="stats-row__value">PB {e.athlete.pbIndoor || e.athlete.pb || e.athlete.waPbIndoor}</span>
            </div>
          ))}
          {!live.champions.length && !live.threats.length ? (
            <p className="panel-note">{tr("Pas encore de tenant du titre ni de record menacé parmi les engagés.", "No defending champion or record threat among the entries yet.")}</p>
          ) : null}
          <h3 className="speaker-sheet__h" style={{ marginTop: 12 }}>Nations</h3>
          <div className="stats-chips">
            {live.nationCounts.map(([noc, count]) => (
              <span key={noc} className={`stats-chip${live.firstTimeNations.includes(noc) ? " stats-chip--new" : ""}`}>{noc}<b>{count}</b></span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export { AnimationEditionPage, AnimationLayout };
