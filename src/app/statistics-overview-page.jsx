import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAllMeetingResults, useAllWinners, useMeetingEditions, useMeetingRecords } from "./meeting-history-hooks";
import { computeAllTimeStats, computeEditionStats, eventLabel, formatPersonName } from "./statistics-compute";
import { useStatisticsEdition } from "./statistics-edition";

/**
 * Vue d'ensemble du module Statistiques.
 * Sans édition choisie : toutes les éditions confondues, pensé pour préparer
 * la com (chiffres clés, faits prêts à copier). Avec une édition : ses
 * chiffres comparés à l'édition précédente.
 */

const NUMBER = new Intl.NumberFormat("fr-FR");

function Kpi({ label, value, sub, delta }) {
  return (
    <div className="stats-kpi">
      <div className="stats-kpi__label">{label}</div>
      <div className="stats-kpi__value">{typeof value === "number" ? NUMBER.format(value) : value}</div>
      {delta ?? (sub ? <div className="stats-kpi__sub">{sub}</div> : null)}
    </div>
  );
}

function Delta({ value, previous, previousYear }) {
  if (previous == null) return <div className="stats-kpi__sub">pas d&apos;édition précédente</div>;
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
      {copied ? "Copié ✓" : "Copier"}
    </button>
  );
}

function EditionBars({ perYear, selected, onPick }) {
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
          title={`${y.year} : ${y.athletes} athlètes, ${y.nations} nations`}
          aria-label={`${y.year} : ${y.athletes} athlètes`}
          onClick={() => onPick(y.year)}
        >
          <span>{String(y.year).slice(2)}</span>
        </button>
      ))}
    </div>
  );
}

function NationChips({ nations, limit = 12 }) {
  const shown = nations.slice(0, limit);
  const rest = nations.length - shown.length;
  return (
    <div className="stats-chips">
      {shown.map(([noc, count]) => (
        <span key={noc} className="stats-chip">{noc}<b>{count}</b></span>
      ))}
      {rest > 0 ? <span className="stats-chip">+ {rest} autres</span> : null}
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
  return (
    <>
      <div className="stats-kpis">
        <Kpi label="Éditions" value={stats.editionCount} sub={stats.firstYear ? `depuis ${stats.firstYear}` : ""} />
        <Kpi label="Athlètes différents" value={stats.athleteCount} sub="ayant pris le départ" />
        <Kpi label="Nations" value={stats.nationCount} sub="au moins un athlète" />
        <Kpi label="Records du meeting" value={stats.meetingRecordCount} sub="en vigueur" />
        <Kpi label="Records nationaux battus" value={stats.nationalRecordPerformances} sub={`${stats.nationalRecordNations} pays`} />
      </div>

      <div className="stats-cols">
        <Box title="Faits marquants pour la com" note="calculés à partir des résultats">
          {stats.facts.length ? stats.facts.map((fact) => (
            <div key={fact.category} className="stats-fact">
              <div>
                <div className="stats-fact__category">{fact.category}</div>
                {fact.text}
              </div>
              <CopyButton text={fact.text} />
            </div>
          )) : <p className="panel-note">Pas encore assez de résultats.</p>}
        </Box>
        <Box title="Records du meeting les plus anciens" link={{ to: "/app/resultats/records", label: "Tous les records" }}>
          {stats.oldestRecords.map((r) => (
            <Row
              key={r.id || `${r.discipline}-${r.gender}`}
              label={eventLabel(r.discipline, r.gender)}
              middle={<>{formatPersonName(r)} ({r.noc}) · <button type="button" className="stats-link" onClick={() => onPickYear(Number(r.year))}>{r.year}</button></>}
              value={r.mark}
            />
          ))}
        </Box>
      </div>

      <div className="stats-cols">
        <Box title="Athlètes par édition" note="cliquer pour ouvrir une édition">
          <EditionBars perYear={stats.perYear} onPick={onPickYear} />
        </Box>
        <Box title="Le plus de victoires" link={{ to: "/app/resultats/hall-of-winners", label: "Palmarès" }}>
          {stats.topWinners.map((w) => (
            <Row
              key={`${w.name}-${w.noc}`}
              label={`${w.wins.length} victoires`}
              middle={<>{w.name} ({w.noc}) <small className="stats-muted">· {w.events.join(", ")}</small></>}
              value={`${w.years[0]}–${w.years[w.years.length - 1]}`}
            />
          ))}
        </Box>
      </div>

      <div className="stats-cols">
        <Box title="Luxembourg au meeting">
          <Row label="Athlètes" middle="luxembourgeois différents" value={NUMBER.format(stats.lux.athletes)} />
          <Row label="Participations" middle="une par athlète et par édition" value={NUMBER.format(stats.lux.participations)} />
          <Row label="Victoires" middle={stats.lux.winners[0] ? `dont ${stats.lux.winners[0].wins.length} pour ${stats.lux.winners[0].name}` : ""} value={stats.lux.wins} />
          <Row
            label="Records nationaux"
            middle={stats.lux.lastNationalRecord ? `dernier : ${formatPersonName(stats.lux.lastNationalRecord)}, ${eventLabel(stats.lux.lastNationalRecord.discipline, stats.lux.lastNationalRecord.gender)} (${stats.lux.lastNationalRecord.year})` : ""}
            value={stats.lux.nationalRecords}
          />
        </Box>
        <Box title="Nations les plus représentées" note="athlètes différents, toutes éditions">
          <NationChips nations={stats.nations} />
        </Box>
      </div>
    </>
  );
}

function EditionOverview({ stats, perYear, onPickYear }) {
  const { current, previous, previousYear, year } = stats;
  if (!current) {
    return (
      <div className="notice-card">
        <strong>Pas encore de résultats pour {year}</strong>
        <p>Les chiffres apparaîtront ici une fois les résultats de l&apos;édition importés. En attendant, choisis « Toutes les éditions ».</p>
      </div>
    );
  }
  const delta = (key) => <Delta value={current[key]} previous={previous?.[key]} previousYear={previousYear} />;
  const mr = stats.records.filter((r) => r.isMeetingRecord);
  const nr = stats.records.filter((r) => r.isNationalRecord);
  return (
    <>
      <div className="stats-kpis">
        <Kpi label="Athlètes" value={current.athletes} delta={delta("athletes")} />
        <Kpi label="Nations" value={current.nations} delta={delta("nations")} />
        <Kpi label="Records du meeting" value={current.meetingRecords} delta={delta("meetingRecords")} />
        <Kpi label="Records nationaux" value={current.nationalRecords} delta={delta("nationalRecords")} />
        <Kpi label="Athlètes luxembourgeois" value={current.luxAthletes} delta={delta("luxAthletes")} />
      </div>

      <div className="stats-cols">
        <Box title="Athlètes par édition" note="cliquer pour changer d'édition">
          <EditionBars perYear={perYear} selected={year} onPick={onPickYear} />
        </Box>
        <Box title={`Records battus en ${year}`} link={{ to: `/app/resultats/editions?edition=${year}`, label: "Résultats" }}>
          {stats.records.length ? stats.records.map((r) => (
            <Row
              key={r.id || `${r.discipline}-${r.gender}-${r.lastName}-${r.round}`}
              label={eventLabel(r.discipline, r.gender)}
              middle={`${formatPersonName(r)} (${r.noc})`}
              value={<>{r.result}{r.isMeetingRecord ? <span className="stats-tag stats-tag--mr">MR</span> : null}{r.isNationalRecord ? <span className="stats-tag stats-tag--nr">NR</span> : null}</>}
            />
          )) : <p className="panel-note">Aucun record battu.</p>}
          {stats.records.length ? <p className="stats-muted stats-small">{mr.length} record(s) du meeting, {nr.length} record(s) national(aux).</p> : null}
        </Box>
      </div>

      <div className="stats-cols">
        <Box title={`Vainqueurs ${year}`} link={{ to: "/app/resultats/hall-of-winners", label: "Palmarès" }}>
          {stats.winners.length ? stats.winners.map((w) => (
            <Row
              key={w.id || `${w.discipline}-${w.gender}`}
              label={eventLabel(w.discipline, w.gender)}
              middle={`${formatPersonName(w)} (${w.noc})`}
              value={w.result}
            />
          )) : <p className="panel-note">Vainqueurs pas encore enregistrés.</p>}
        </Box>
        <Box title="Nations représentées" note={`${current.nations} nations`}>
          <NationChips nations={stats.nations} limit={20} />
        </Box>
      </div>
    </>
  );
}

function StatisticsOverviewPage() {
  const { edition, setEdition } = useStatisticsEdition();
  const { results, loading: resultsLoading, error } = useAllMeetingResults();
  const { records, loading: recordsLoading } = useMeetingRecords();
  const { winners, loading: winnersLoading } = useAllWinners();
  const { editions, loading: editionsLoading } = useMeetingEditions();
  const loading = resultsLoading || recordsLoading || winnersLoading || editionsLoading;

  const allTime = useMemo(
    () => (loading ? null : computeAllTimeStats({ results, records, winners, editions })),
    [loading, results, records, winners, editions],
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
          <h1>Vue d&apos;ensemble</h1>
          <p>
            {edition
              ? `Édition ${edition}, comparée à l'édition précédente.`
              : "Toutes les éditions confondues : les chiffres et faits marquants à reprendre dans la com."}
          </p>
        </div>
      </section>
      {error ? <div className="notice-card notice-card--warn"><strong>Erreur de chargement</strong><p>{error}</p></div> : null}
      {loading ? <p className="panel-note">Chargement de l&apos;historique du meeting…</p> : null}
      {!loading && !error && !edition && allTime ? <AllTimeOverview stats={allTime} onPickYear={pickYear} /> : null}
      {!loading && !error && edition && editionStats ? (
        <EditionOverview stats={editionStats} perYear={allTime?.perYear ?? []} onPickYear={pickYear} />
      ) : null}
    </div>
  );
}

export { StatisticsOverviewPage };
