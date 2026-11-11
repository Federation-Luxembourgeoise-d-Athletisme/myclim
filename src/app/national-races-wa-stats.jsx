import { useEffect, useState } from "react";
import { parsePerformanceToSeconds } from "./national-races-helpers";
import { formatDateForDisplay } from "./u14-helpers";

// Statistiques World Athletics d'un athlète des courses nationales, chargées
// dès que la commission saisit son WAID (ou colle le lien de son profil).
// Source : /api/wa (netlify/functions/wa-athlete.mjs).

const WA_PROFILE_BASE = "https://worldathletics.org/athletes/_/";

// Lignes affichées selon la course : 60 m salle + 100 m plein air, ou
// 800 m salle + plein air.
function getStatRows(raceEvent) {
  if (raceEvent === "800 m") {
    return [
      { key: "800i", code: "800", indoor: true, label: "800 m (i)" },
      { key: "800o", code: "800", indoor: false, label: "800 m" },
    ];
  }
  return [
    { key: "60i", code: "60", indoor: true, label: "60 m (i)" },
    { key: "100o", code: "100", indoor: false, label: "100 m" },
  ];
}

function fastest(results) {
  let best = null;
  let bestSeconds = Infinity;
  results.forEach((result) => {
    const seconds = parsePerformanceToSeconds(result.mark);
    if (seconds !== null && !result.notLegal && seconds < bestSeconds) {
      best = result;
      bestSeconds = seconds;
    }
  });
  return best;
}

function yearOf(result) {
  return result?.date ? Number(String(result.date).slice(0, 4)) : null;
}

function placeOf(result) {
  return [result?.venue].filter(Boolean).join("");
}

function useWaAthleteStats(waid) {
  const [state, setState] = useState({ status: "idle", data: null, error: "" });

  useEffect(() => {
    if (!waid) {
      setState({ status: "idle", data: null, error: "" });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: "loading", data: null, error: "" });
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/wa/athlete/${waid}/performances`, { signal: controller.signal });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        setState({ status: "ready", data: body, error: "" });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ status: "error", data: null, error: error.message });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [waid]);

  return state;
}

// Calcule PB, SB par année et dernière course pour chaque ligne.
function buildStats(data, raceEvent) {
  const pbs = Array.isArray(data?.personalBests) ? data.personalBests : [];
  const results = Array.isArray(data?.seasonBests) ? data.seasonBests : [];
  // Mêmes trois saisons que la fonction wa-athlete (année en cours et deux précédentes).
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];

  const rows = getStatRows(raceEvent).map((row) => {
    const matches = (result) => String(result.disciplineCode || "").toUpperCase() === row.code && Boolean(result.indoor) === row.indoor;
    const rowResults = results.filter(matches);
    const latest = rowResults.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
    return {
      ...row,
      pb: fastest(pbs.filter(matches)),
      seasons: Object.fromEntries(years.map((year) => [year, fastest(rowResults.filter((result) => yearOf(result) === year))])),
      latest,
      count: rowResults.length,
    };
  });

  // Temps de référence pour le classement : épreuve de la course, toutes
  // conditions confondues (60 m = salle uniquement).
  const raceCode = raceEvent === "800 m" ? "800" : "60";
  const raceResults = results.filter((result) => String(result.disciplineCode || "").toUpperCase() === raceCode && (raceCode === "800" || result.indoor));
  const seasonBest = fastest(raceResults.filter((result) => yearOf(result) === currentYear));
  const previousSeasonBest = fastest(raceResults.filter((result) => yearOf(result) === currentYear - 1));

  return { rows, years, seasonBest, previousSeasonBest, currentYear };
}

function MarkCell({ result, showYear = false }) {
  if (!result) return <td className="natwa__empty">-</td>;
  const detail = [placeOf(result), result.date ? formatDateForDisplay(String(result.date).slice(0, 10)) : ""].filter(Boolean).join(" · ");
  return (
    <td title={detail}>
      <strong>{result.mark}</strong>
      {showYear && yearOf(result) ? <span className="natwa__year"> {String(yearOf(result)).slice(2)}</span> : null}
    </td>
  );
}

const PANEL_COPY = {
  fr: {
    title: "World Athletics",
    loading: "Chargement des performances…",
    error: "Impossible de charger le profil World Athletics.",
    discipline: "Épreuve",
    latest: "Dernière course",
    races: "{count} courses",
    none: "Aucune performance trouvée sur 60/100 m ou 800 m.",
    fill: "Reprendre dans la fiche",
    fillHint: "Remplit les champs vides : nom, naissance, nationalité, SB.",
    profile: "Profil ↗",
  },
  en: {
    title: "World Athletics",
    loading: "Loading performances…",
    error: "Could not load the World Athletics profile.",
    discipline: "Event",
    latest: "Latest race",
    races: "{count} races",
    none: "No performance found over 60/100 m or 800 m.",
    fill: "Copy into the record",
    fillHint: "Fills the empty fields: name, birth date, nationality, SB.",
    profile: "Profile ↗",
  },
};

function WaStatsPanel({ waid, raceEvent, language = "fr", onFill = null }) {
  const { status, data, error } = useWaAthleteStats(waid);
  const text = PANEL_COPY[language] || PANEL_COPY.fr;
  if (!waid || status === "idle") return null;

  if (status === "loading") return <div className="natwa natwa--muted">{text.loading}</div>;
  if (status === "error") return <div className="natwa natwa--error" title={error}>{text.error}</div>;

  const stats = buildStats(data, raceEvent);
  const hasAny = stats.rows.some((row) => row.pb || row.count);
  const identity = [
    [data.firstName, data.lastName].filter(Boolean).join(" "),
    data.countryCode,
    data.birthDate ? String(data.birthDate).slice(0, 4) : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="natwa">
      <div className="natwa__head">
        <strong>{identity || text.title}</strong>
        <span className="natwa__actions">
          <a href={`${WA_PROFILE_BASE}${waid}`} rel="noreferrer" target="_blank">{text.profile}</a>
          {onFill ? (
            <button className="button button--secondary button--small" title={text.fillHint} type="button" onClick={() => onFill(data, stats)}>
              {text.fill}
            </button>
          ) : null}
        </span>
      </div>
      {hasAny ? (
        <table className="natwa__table">
          <thead>
            <tr>
              <th>{text.discipline}</th>
              <th>PB</th>
              {stats.years.map((year) => <th key={year}>SB {year}</th>)}
              <th>{text.latest}</th>
            </tr>
          </thead>
          <tbody>
            {stats.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  {row.label}
                  {row.count ? <span className="natwa__count">{text.races.replace("{count}", row.count)}</span> : null}
                </th>
                <MarkCell result={row.pb} showYear />
                {stats.years.map((year) => <MarkCell key={year} result={row.seasons[year]} />)}
                <td className="natwa__latest" title={placeOf(row.latest)}>
                  {row.latest
                    ? `${row.latest.mark} · ${formatDateForDisplay(String(row.latest.date).slice(0, 10))}`
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <span className="natwa--muted">{text.none}</span>
      )}
    </div>
  );
}

export { WaStatsPanel };
