import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAllMeetingResults, useAllWinners, useMeetingEditions, useMeetingRecords } from "./meeting-history-hooks";
import { computeAllTimeStats, computeEditionStats, eventLabel, formatPersonName } from "./statistics-compute";
import { useStatisticsEdition } from "./statistics-edition";
import { useLanguage } from "./language-context";
import { useTr } from "./use-tr";

/**
 * Vue d'ensemble du module Statistiques.
 * Sans édition choisie : toutes les éditions confondues, pensé pour préparer
 * la com (chiffres clés, faits prêts à copier). Avec une édition : ses
 * chiffres comparés à l'édition précédente.
 */

function useNumberFormat() {
  const { language } = useLanguage();
  return useMemo(() => new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-GB"), [language]);
}

function Kpi({ label, value, sub, delta }) {
  const number = useNumberFormat();
  return (
    <div className="stats-kpi">
      <div className="stats-kpi__label">{label}</div>
      <div className="stats-kpi__value">{typeof value === "number" ? number.format(value) : value}</div>
      {delta ?? (sub ? <div className="stats-kpi__sub">{sub}</div> : null)}
    </div>
  );
}

function Delta({ value, previous, previousYear }) {
  const tr = useTr();
  if (previous == null) return <div className="stats-kpi__sub">{tr("pas d'édition précédente", "no previous edition")}</div>;
  const diff = value - previous;
  if (diff === 0) return <div className="stats-kpi__sub">= {previousYear}</div>;
  return (
    <div className={`stats-kpi__delta ${diff > 0 ? "is-up" : "is-down"}`}>
      {diff > 0 ? "▲ +" : "▼ "}{diff} vs {previousYear}
    </div>
  );
}

function Box({ title, note, link, children }) {
  return (
    <section className="stats-box">
      <header className="stats-box__head">
        <h2>{title}{note ? <span className="stats-box__note"> · {note}</span> : null}</h2>
        {link ? <Link to={link.to}>{link.label} ›</Link> : null}
      </header>
      {children}
    </section>
  );
}

function CopyButton({ text }) {
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
      {copied ? tr("Copié ✓", "Copied ✓") : tr("Copier", "Copy")}
    </button>
  );
}

function EditionBars({ perYear, selected, onPick }) {
  const tr = useTr();
  const max = Math.max(1, ...perYear.map((y) => y.athletes));
  return (
    <div className="stats-bars" role="list">
      {perYear.map((y) => (
        <button
          key={y.year}
          type="button"
          role="listitem"
          className={`stats-bars__bar${y.year === selected ? " is-selected" : ""}`}
          style={{ height: `${Math.max(4, (y.athletes / max) * 100)}%` }}
          title={tr(`${y.year} : ${y.athletes} athlètes, ${y.nations} nations`, `${y.year}: ${y.athletes} athletes, ${y.nations} nations`)}
          aria-label={tr(`${y.year} : ${y.athletes} athlètes`, `${y.year}: ${y.athletes} athletes`)}
          onClick={() => onPick(y.year)}
        >
          <span>{String(y.year).slice(2)}</span>
        </button>
      ))}
    </div>
  );
}

function NationChips({ nations, limit = 12 }) {
  const tr = useTr();
  const shown = nations.slice(0, limit);
  const rest = nations.length - shown.length;
  return (
    <div className="stats-chips">
      {shown.map(([noc, count]) => (
        <span key={noc} className="stats-chip">{noc}<b>{count}</b></span>
      ))}
      {rest > 0 ? <span className="stats-chip">{tr(`+ ${rest} autres`, `+ ${rest} more`)}</span> : null}
    </div>
  );
}

function Row({ label, middle, value }) {
  return (
    <div className="stats-row">
      <span className="stats-row__label">{label}</span>
      <span>{middle}</span>
      <span className="stats-row__value">{value}</span>
    </div>
  );
}

function AllTimeOverview({ stats, onPickYear }) {
  const tr = useTr();
  const { language } = useLanguage();
  const number = useNumberFormat();
  const lastNr = stats.lux.lastNationalRecord;
  return (
    <>
      <div className="stats-kpis">
        <Kpi label={tr("Éditions", "Editions")} value={stats.editionCount} sub={stats.firstYear ? tr(`depuis ${stats.firstYear}`, `since ${stats.firstYear}`) : ""} />
        <Kpi label={tr("Athlètes différents", "Different athletes")} value={stats.athleteCount} sub={tr("ayant pris le départ", "who started")} />
        <Kpi label={tr("Nations", "Nations")} value={stats.nationCount} sub={tr("au moins un athlète", "at least one athlete")} />
        <Kpi label={tr("Records du meeting", "Meeting records")} value={stats.meetingRecordCount} sub={tr("en vigueur", "current")} />
        <Kpi
          label={tr("Records nationaux battus", "National records broken")}
          value={stats.nationalRecordPerformances}
          sub={tr(`${stats.nationalRecordNations} pays`, stats.nationalRecordNations === 1 ? "1 country" : `${stats.nationalRecordNations} countries`)}
        />
      </div>

      <div className="stats-cols">
        <Box title={tr("Faits marquants pour la com", "Highlights for communication")} note={tr("calculés à partir des résultats", "computed from the results")}>
          {stats.facts.length ? stats.facts.map((fact) => (
            <div key={fact.category} className="stats-fact">
              <div>
                <div className="stats-fact__category">{fact.category}</div>
                {fact.text}
              </div>
              <CopyButton text={fact.text} />
            </div>
          )) : <p className="panel-note">{tr("Pas encore assez de résultats.", "Not enough results yet.")}</p>}
        </Box>
        <Box title={tr("Records du meeting les plus anciens", "Oldest meeting records")} link={{ to: "/app/resultats/records", label: tr("Tous les records", "All records") }}>
          {stats.oldestRecords.map((r) => (
            <Row
              key={r.id || `${r.discipline}-${r.gender}`}
              label={eventLabel(r.discipline, r.gender, language)}
              middle={<>{formatPersonName(r)} ({r.noc}) · <button type="button" className="stats-link" onClick={() => onPickYear(Number(r.year))}>{r.year}</button></>}
              value={r.mark}
            />
          ))}
        </Box>
      </div>

      <div className="stats-cols">
        <Box title={tr("Athlètes par édition", "Athletes per edition")} note={tr("cliquer pour ouvrir une édition", "click to open an edition")}>
          <EditionBars perYear={stats.perYear} onPick={onPickYear} />
        </Box>
        <Box title={tr("Le plus de victoires", "Most wins")} link={{ to: "/app/resultats/hall-of-winners", label: tr("Palmarès", "Hall of Winners") }}>
          {stats.topWinners.map((w) => (
            <Row
              key={`${w.name}-${w.noc}`}
              label={tr(`${w.wins.length} victoires`, `${w.wins.length} wins`)}
              middle={<>{w.name} ({w.noc}) <small className="stats-muted">· {w.events.join(", ")}</small></>}
              value={`${w.years[0]}–${w.years[w.years.length - 1]}`}
            />
          ))}
        </Box>
      </div>

      <div className="stats-cols">
        <Box title={tr("Luxembourg au meeting", "Luxembourg at the meeting")}>
          <Row label={tr("Athlètes", "Athletes")} middle={tr("luxembourgeois différents", "different Luxembourg athletes")} value={number.format(stats.lux.athletes)} />
          <Row label={tr("Participations", "Participations")} middle={tr("une par athlète et par édition", "one per athlete and per edition")} value={number.format(stats.lux.participations)} />
          <Row
            label={tr("Victoires", "Wins")}
            middle={stats.lux.winners[0]
              ? tr(`dont ${stats.lux.winners[0].wins.length} pour ${stats.lux.winners[0].name}`, `including ${stats.lux.winners[0].wins.length} for ${stats.lux.winners[0].name}`)
              : ""}
            value={stats.lux.wins}
          />
          <Row
            label={tr("Records nationaux", "National records")}
            middle={lastNr
              ? tr(
                `dernier : ${formatPersonName(lastNr)}, ${eventLabel(lastNr.discipline, lastNr.gender, language)} (${lastNr.year})`,
                `latest: ${formatPersonName(lastNr)}, ${eventLabel(lastNr.discipline, lastNr.gender, language)} (${lastNr.year})`,
              )
              : ""}
            value={stats.lux.nationalRecords}
          />
        </Box>
        <Box title={tr("Nations les plus représentées", "Most represented nations")} note={tr("athlètes différents, toutes éditions", "different athletes, all editions")}>
          <NationChips nations={stats.nations} />
        </Box>
      </div>
    </>
  );
}

function EditionOverview({ stats, perYear, onPickYear }) {
  const tr = useTr();
  const { language } = useLanguage();
  const { current, previous, previousYear, year } = stats;
  if (!current) {
    return (
      <div className="notice-card">
        <strong>{tr(`Pas encore de résultats pour ${year}`, `No results yet for ${year}`)}</strong>
        <p>
          {tr(
            "Les chiffres apparaîtront ici une fois les résultats de l'édition importés. En attendant, choisis « Toutes les éditions ».",
            "The figures will appear here once the edition's results are imported. In the meantime, choose “All editions”.",
          )}
        </p>
      </div>
    );
  }
  const delta = (key) => <Delta value={current[key]} previous={previous?.[key]} previousYear={previousYear} />;
  const mr = stats.records.filter((r) => r.isMeetingRecord);
  const nr = stats.records.filter((r) => r.isNationalRecord);
  return (
    <>
      <div className="stats-kpis">
        <Kpi label={tr("Athlètes", "Athletes")} value={current.athletes} delta={delta("athletes")} />
        <Kpi label={tr("Nations", "Nations")} value={current.nations} delta={delta("nations")} />
        <Kpi label={tr("Records du meeting", "Meeting records")} value={current.meetingRecords} delta={delta("meetingRecords")} />
        <Kpi label={tr("Records nationaux", "National records")} value={current.nationalRecords} delta={delta("nationalRecords")} />
        <Kpi label={tr("Athlètes luxembourgeois", "Luxembourg athletes")} value={current.luxAthletes} delta={delta("luxAthletes")} />
      </div>

      <div className="stats-cols">
        <Box title={tr("Athlètes par édition", "Athletes per edition")} note={tr("cliquer pour changer d'édition", "click to change edition")}>
          <EditionBars perYear={perYear} selected={year} onPick={onPickYear} />
        </Box>
        <Box title={tr(`Records battus en ${year}`, `Records broken in ${year}`)} link={{ to: `/app/resultats/editions?edition=${year}`, label: tr("Résultats", "Results") }}>
          {stats.records.length ? stats.records.map((r) => (
            <Row
              key={r.id || `${r.discipline}-${r.gender}-${r.lastName}-${r.round}`}
              label={eventLabel(r.discipline, r.gender, language)}
              middle={`${formatPersonName(r)} (${r.noc})`}
              value={<>{r.result}{r.isMeetingRecord ? <span className="stats-tag stats-tag--mr">MR</span> : null}{r.isNationalRecord ? <span className="stats-tag stats-tag--nr">NR</span> : null}</>}
            />
          )) : <p className="panel-note">{tr("Aucun record battu.", "No records broken.")}</p>}
          {stats.records.length ? (
            <p className="stats-muted stats-small">
              {tr(
                `${mr.length} record(s) du meeting, ${nr.length} record(s) national(aux).`,
                `${mr.length} meeting record${mr.length === 1 ? "" : "s"}, ${nr.length} national record${nr.length === 1 ? "" : "s"}.`,
              )}
            </p>
          ) : null}
        </Box>
      </div>

      <div className="stats-cols">
        <Box title={tr(`Vainqueurs ${year}`, `${year} winners`)} link={{ to: "/app/resultats/hall-of-winners", label: tr("Palmarès", "Hall of Winners") }}>
          {stats.winners.length ? stats.winners.map((w) => (
            <Row
              key={w.id || `${w.discipline}-${w.gender}`}
              label={eventLabel(w.discipline, w.gender, language)}
              middle={`${formatPersonName(w)} (${w.noc})`}
              value={w.result}
            />
          )) : <p className="panel-note">{tr("Vainqueurs pas encore enregistrés.", "Winners not recorded yet.")}</p>}
        </Box>
        <Box title={tr("Nations représentées", "Nations represented")} note={`${current.nations} nations`}>
          <NationChips nations={stats.nations} limit={20} />
        </Box>
      </div>
    </>
  );
}

function StatisticsOverviewPage() {
  const tr = useTr();
  const { language } = useLanguage();
  const { edition, setEdition } = useStatisticsEdition();
  const { results, loading: resultsLoading, error } = useAllMeetingResults();
  const { records, loading: recordsLoading } = useMeetingRecords();
  const { winners, loading: winnersLoading } = useAllWinners();
  const { editions, loading: editionsLoading } = useMeetingEditions();
  const loading = resultsLoading || recordsLoading || winnersLoading || editionsLoading;

  const allTime = useMemo(
    () => (loading ? null : computeAllTimeStats({ results, records, winners, editions, language })),
    [loading, results, records, winners, editions, language],
  );
  const editionStats = useMemo(
    () => (loading || !edition ? null : computeEditionStats({ results, winners, year: edition })),
    [loading, results, winners, edition],
  );

  function pickYear(year) {
    setEdition(year);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="page stats-overview">
      <section className="page-header">
        <div>
          <h1>{tr("Vue d'ensemble", "Overview")}</h1>
          <p>
            {edition
              ? tr(`Édition ${edition}, comparée à l'édition précédente.`, `${edition} edition, compared with the previous edition.`)
              : tr(
                "Toutes les éditions confondues : les chiffres et faits marquants à reprendre dans la com.",
                "All editions combined: the figures and highlights to use in communication.",
              )}
          </p>
        </div>
      </section>
      {error ? <div className="notice-card notice-card--warn"><strong>{tr("Erreur de chargement", "Loading error")}</strong><p>{error}</p></div> : null}
      {loading ? <p className="panel-note">{tr("Chargement de l'historique du meeting…", "Loading the meeting history…")}</p> : null}
      {!loading && !error && !edition && allTime ? <AllTimeOverview stats={allTime} onPickYear={pickYear} /> : null}
      {!loading && !error && edition && editionStats ? (
        <EditionOverview stats={editionStats} perYear={allTime?.perYear ?? []} onPickYear={pickYear} />
      ) : null}
    </div>
  );
}

export { StatisticsOverviewPage };
