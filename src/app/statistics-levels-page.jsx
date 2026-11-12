import { useMemo, useState } from "react";
import { useAllMeetingResults, useAllWinners, useMeetingEditions, useMeetingRecords } from "./meeting-history-hooks";
import { useAthletes } from "./athlete-portal-hooks";
import { useActiveEdition } from "./edition";
import { formatPersonName } from "./statistics-compute";
import { MEETING_LEVELS, buildSpeakerSheets, computeLevelComparison, formatMark, levelYears } from "./statistics-levels";
import { useStatisticsEdition } from "./statistics-edition";
import { useLanguage } from "./language-context";
import { useTr } from "./use-tr";

/**
 * Statistiques › Par niveau : le meeting sans label, en Bronze (2021–2024) et
 * en Silver (2025+) — participation, records, perfs par épreuve.
 * Statistiques › Fiches speaker : une fiche par épreuve de l'édition avec les
 * engagés, leur passé au meeting et des phrases prêtes à dire au micro.
 */

function CopyButton({ text, label }) {
  const tr = useTr();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button type="button" className="stats-copy" onClick={copy}>
      {copied ? tr("Copié ✓", "Copied ✓") : label || tr("Copier", "Copy")}
    </button>
  );
}

function LevelBadge({ level }) {
  const tr = useTr();
  if (!level) return null;
  return <span className={`level-badge level-badge--${level.key}`}>{tr(level.label, level.labelEn)}</span>;
}

function useHistory() {
  const { editions, loading: editionsLoading } = useMeetingEditions();
  const { results, loading: resultsLoading, error } = useAllMeetingResults();
  const usable = useMemo(() => {
    const hidden = new Set(editions.filter((e) => e.cancelled).map((e) => Number(e.year)));
    return results.filter((row) => !hidden.has(Number(row.year)));
  }, [results, editions]);
  return { results: usable, loading: editionsLoading || resultsLoading, error };
}

// ─── Par niveau ─────────────────────────────────────────────────────────────

function StatisticsLevelsPage() {
  const tr = useTr();
  const { language } = useLanguage();
  const { results, loading, error } = useHistory();
  const data = useMemo(() => (loading ? null : computeLevelComparison({ results, language })), [loading, results, language]);
  const number = useMemo(() => new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 1 }), [language]);
  const n = (value) => (value == null ? "—" : number.format(value));

  if (error) return <div className="notice-card notice-card--warn"><strong>{tr("Erreur de chargement", "Loading error")}</strong><p>{error}</p></div>;
  if (!data) return <p className="panel-note">{tr("Chargement de l'historique du meeting…", "Loading the meeting history…")}</p>;

  const metrics = [
    { label: tr("Éditions", "Editions"), value: (l) => l.editions },
    { label: tr("Athlètes par édition", "Athletes per edition"), value: (l) => n(Math.round(l.avgAthletes ?? 0) || null), highlight: true },
    { label: tr("Nations par édition", "Nations per edition"), value: (l) => n(l.avgNations), highlight: true },
    { label: tr("Nations différentes", "Different nations"), value: (l) => l.nations },
    { label: tr("Nouvelles nations", "New nations"), value: (l) => l.newNations.length, title: (l) => l.newNations.join(", ") },
    { label: tr("Athlètes étrangers", "Foreign athletes"), value: (l) => (l.foreignShare == null ? "—" : `${Math.round(l.foreignShare * 100)} %`) },
    { label: tr("Records du meeting par édition", "Meeting records per edition"), value: (l) => n(l.mrPerEdition), highlight: true },
    { label: tr("Records nationaux par édition", "National records per edition"), value: (l) => n(l.nrPerEdition) },
  ];
  const [base, , latest] = data.levels;

  return (
    <div className="stats-levels">
      <div className="stats-cols">
        <section className="stats-box">
          <header className="stats-box__head">
            <h2>{tr("Le meeting à chaque niveau", "The meeting at each level")}</h2>
            <span className="stats-box__note">World Athletics Indoor Tour</span>
          </header>
          <div className="table-wrap">
            <table className="data-table data-table--sheet levels-table">
              <thead>
                <tr>
                  <th />
                  {data.levels.map((level) => (
                    <th key={level.key}><LevelBadge level={level} /> <small className="stats-muted">{levelYears(level)}</small></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric) => (
                  <tr key={metric.label} className={metric.highlight ? "is-highlight" : ""}>
                    <th scope="row">{metric.label}</th>
                    {data.levels.map((level) => (
                      <td key={level.key} title={metric.title ? metric.title(level) : undefined}>{metric.value(level)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="stats-muted stats-small">
            {tr(
              "Moyennes par édition disputée (2022 annulée). Nouvelles nations = pays jamais venus avant ce niveau. Records : notes « Meeting Record » / « National Record » des résultats.",
              "Averages per edition held (2022 cancelled). New nations = countries that had never come before this level. Records: “Meeting Record” / “National Record” notes in the results.",
            )}
          </p>
        </section>
        <section className="stats-box">
          <header className="stats-box__head"><h2>{tr("À dire au micro / dans la com", "For the microphone / communication")}</h2></header>
          {data.facts.map((fact) => (
            <div key={fact.text} className="stats-fact">
              <div>
                <div className="stats-fact__category">{fact.category}</div>
                {fact.text}
              </div>
              <CopyButton text={fact.text} />
            </div>
          ))}
        </section>
      </div>

      <section className="stats-box" style={{ marginTop: 14 }}>
        <header className="stats-box__head">
          <h2>{tr("Niveau des épreuves", "Level of the events")}</h2>
          <span className="stats-box__note">
            {tr("perf gagnante moyenne · meilleure perf du niveau", "average winning mark · best mark of the level")}
          </span>
        </header>
        <div className="table-wrap">
          <table className="data-table data-table--sheet levels-table levels-table--events">
            <thead>
              <tr>
                <th>{tr("Épreuve", "Event")}</th>
                {data.levels.map((level) => <th key={level.key}><LevelBadge level={level} /></th>)}
                <th>{tr(latest.label, latest.labelEn)} vs {tr(base.label, base.labelEn).toLowerCase()}</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((event) => {
                const from = event.byLevel[base.key];
                const to = event.byLevel[latest.key];
                const diff = from && to ? (event.field ? to.average - from.average : from.average - to.average) : null;
                return (
                  <tr key={event.key}>
                    <th scope="row">{event.label}</th>
                    {MEETING_LEVELS.map((level) => {
                      const slot = event.byLevel[level.key];
                      return (
                        <td key={level.key} className="sheet-nowrap">
                          {slot ? (
                            <>
                              <strong>{formatMark(slot.average, event.field)}</strong>
                              <span className="stats-muted" title={`${slot.bestBy} · ${slot.bestYear}`}> · {formatMark(slot.best, event.field)}</span>
                            </>
                          ) : <span className="stats-muted">—</span>}
                        </td>
                      );
                    })}
                    <td className="sheet-nowrap">
                      {diff == null ? <span className="stats-muted">—</span> : (
                        <span className={diff > 0 ? "levels-up" : "levels-down"}>
                          {diff > 0 ? "▲ " : "▼ "}
                          {event.field ? `${Math.round(Math.abs(diff) * 100)} cm` : `${Math.abs(diff).toFixed(2)} s`}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="stats-muted stats-small">
          {tr(
            "Perf gagnante = meilleure marque de l'épreuve à chaque édition (séries comprises). Survoler la meilleure perf pour voir l'athlète et l'année. Seules les épreuves disputées à au moins deux niveaux sont affichées ; Special Olympics et para exclus.",
            "Winning mark = best mark of the event at each edition (heats included). Hover the best mark to see the athlete and year. Only events held at two levels or more are shown; Special Olympics and para events excluded.",
          )}
        </p>
      </section>
    </div>
  );
}

// ─── Fiches speaker ─────────────────────────────────────────────────────────

const TAG_CLASS = { mr: "stats-tag--mr", win: "stats-tag--win", new: "stats-tag--new", loyal: "stats-tag--loyal", lux: "stats-tag--lux", muted: "stats-tag--muted" };

function SpeakerSheet({ sheet, year }) {
  const tr = useTr();
  const competitors = sheet.entries.filter((e) => !e.pacer).length;
  return (
    <section className="stats-box speaker-sheet" id={`speaker-${sheet.key.replace(/[^a-z0-9]+/gi, "-")}`}>
      <header className="stats-box__head">
        <h2>{sheet.label}</h2>
        <span className="stats-box__note">{tr(`${competitors} engagé${competitors > 1 ? "s" : ""}`, `${competitors} entr${competitors > 1 ? "ies" : "y"}`)}</span>
      </header>

      <div className="speaker-sheet__top">
        <div>
          <h3 className="speaker-sheet__h">{tr("À dire au micro", "For the microphone")}</h3>
          {sheet.lines.length ? (
            <ul className="speaker-sheet__lines">
              {sheet.lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          ) : <p className="stats-muted stats-small">{tr("Rien de marquant trouvé dans l'historique.", "Nothing notable found in the history.")}</p>}
          {sheet.lines.length ? <CopyButton text={sheet.lines.join("\n")} label={tr("Copier les phrases", "Copy the lines")} /> : null}
        </div>
        <div>
          <h3 className="speaker-sheet__h">{tr("Repères", "Reference marks")}</h3>
          <div className="stats-row">
            <span className="stats-row__label">{tr("Record du meeting", "Meeting record")}</span>
            <span>{sheet.record ? `${formatPersonName(sheet.record)} (${sheet.record.noc}) · ${sheet.record.year}` : "—"}</span>
            <span className="stats-row__value">{sheet.record?.mark || ""}</span>
          </div>
          {sheet.levelBests.map(({ level, best }) => (
            <div key={level.key} className="stats-row">
              <span className="stats-row__label">{tr(`Meilleure perf ${level.label}`, `Best mark ${level.labelEn}`)}</span>
              <span>{best ? `${best.name} (${best.noc}) · ${best.year}` : <span className="stats-muted">{tr("pas disputée", "not held")}</span>}</span>
              <span className="stats-row__value">{best?.mark || ""}</span>
            </div>
          ))}
          {sheet.lastWinners.map((w) => (
            <div key={w.id || w.year} className="stats-row">
              <span className="stats-row__label">{tr(`Vainqueur ${w.year}`, `${w.year} winner`)}</span>
              <span>{formatPersonName(w)} ({w.noc})</span>
              <span className="stats-row__value">{w.result || w.mark || ""}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table data-table--sheet speaker-sheet__table">
          <thead>
            <tr>
              <th>{tr("Athlète", "Athlete")}</th>
              <th>Nat.</th>
              <th>PB</th>
              <th>SB</th>
              <th>{tr(`Au meeting avant ${year}`, `At the meeting before ${year}`)}</th>
              <th>{tr("À savoir", "Good to know")}</th>
            </tr>
          </thead>
          <tbody>
            {sheet.entries.map(({ athlete, history, tags }) => (
              <tr key={athlete.id}>
                <td className="sheet-name">{formatPersonName(athlete)}</td>
                <td>{athlete.nationality || "—"}</td>
                <td className="sheet-nowrap">{athlete.pbIndoor || athlete.pb || athlete.waPbIndoor || "—"}</td>
                <td className="sheet-nowrap">{athlete.sb || athlete.waIndoorSbCurrent || athlete.waIndoorSb || "—"}</td>
                <td>
                  {history.years.length ? (
                    <>
                      {tr(`${history.years.length} éd.`, `${history.years.length} ed.`)} <span className="stats-muted">({history.years[0]}{history.years.length > 1 ? `–${history.years[history.years.length - 1]}` : ""})</span>
                      {history.best ? <span className="stats-muted"> · {tr("meilleure perf ici", "best here")} {history.best.mark} ({history.best.year})</span> : null}
                      {history.bestRank && !history.winYears.length ? <span className="stats-muted"> · {tr(`meilleure place ${history.bestRank}e`, `best place ${history.bestRank}`)}</span> : null}
                    </>
                  ) : <span className="stats-muted">—</span>}
                </td>
                <td>{tags.map((tag) => <span key={tag.text} className={`stats-tag ${TAG_CLASS[tag.kind] || ""}`}>{tag.text}</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SpeakerSheetsPage({ standalone = false }) {
  if (!standalone) return <SpeakerSheetsContent />;
  return <StandaloneSpeakerSheets />;
}

// Page « Fiches speaker » hors du module Statistiques (rôle speaker).
function StandaloneSpeakerSheets() {
  const tr = useTr();
  return (
    <div className="page">
      <section className="page-header">
        <div>
          <p className="eyebrow">{tr("Athlètes", "Athletes")}</p>
          <h1>{tr("Fiches speaker", "Speaker sheets")}</h1>
        </div>
      </section>
      <SpeakerSheetsContent />
    </div>
  );
}

function SpeakerSheetsContent() {
  const tr = useTr();
  const { language } = useLanguage();
  const { edition } = useStatisticsEdition();
  const { activeEditionId, loading: editionLoading } = useActiveEdition(true);
  // L'édition choisie dans la barre, sinon l'édition active (celle qu'on prépare).
  const year = edition || Number(activeEditionId) || new Date().getFullYear();
  const { athletes, loading: athletesLoading } = useAthletes(!editionLoading, String(year));
  const { results, loading: resultsLoading, error } = useHistory();
  const { records, loading: recordsLoading } = useMeetingRecords();
  const { winners, loading: winnersLoading } = useAllWinners();
  const [eventFilter, setEventFilter] = useState("");
  const loading = editionLoading || athletesLoading || resultsLoading || recordsLoading || winnersLoading;

  const data = useMemo(
    () => (loading ? null : buildSpeakerSheets({ athletes, results, records, winners, year, language })),
    [loading, athletes, results, records, winners, year, language],
  );
  const sheets = data ? data.sheets.filter((s) => !eventFilter || s.key === eventFilter) : [];

  return (
    <div className="speaker-sheets">
      <div className="speaker-sheets__bar">
        <p className="stats-muted" style={{ margin: 0 }}>
          {tr(`Édition ${year}`, `${year} edition`)} <LevelBadge level={data?.level} /> ·{" "}
          {tr(
            "une fiche par épreuve, à partir des engagés (sans les « out ») et de tout l'historique du meeting.",
            "one sheet per event, built from the entries (without “out”) and the whole meeting history.",
          )}
        </p>
        {data?.sheets.length ? (
          <>
            <select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} aria-label={tr("Épreuve", "Event")}>
              <option value="">{tr("Toutes les épreuves", "All events")}</option>
              {data.sheets.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button type="button" className="button button--secondary button--small" onClick={() => window.print()}>
              {tr("Imprimer", "Print")}
            </button>
          </>
        ) : null}
      </div>
      {error ? <div className="notice-card notice-card--warn"><strong>{tr("Erreur de chargement", "Loading error")}</strong><p>{error}</p></div> : null}
      {loading ? <p className="panel-note">{tr("Chargement des engagés et de l'historique…", "Loading the entries and the history…")}</p> : null}
      {data && !data.sheets.length ? (
        <div className="notice-card">
          <strong>{tr(`Pas encore d'engagés pour ${year}`, `No entries yet for ${year}`)}</strong>
          <p>
            {tr(
              "Les fiches se remplissent dès que les engagés sont importés dans Athlètes › Engagés. Pour voir un exemple, choisis une édition passée dans la barre en haut.",
              "The sheets fill in as soon as the entries are imported in Athletes › Entries. To see an example, pick a past edition in the bar at the top.",
            )}
          </p>
        </div>
      ) : null}
      {sheets.map((sheet) => <SpeakerSheet key={sheet.key} sheet={sheet} year={year} />)}
    </div>
  );
}

export { SpeakerSheetsPage, StatisticsLevelsPage };
