import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { getActiveEditionId } from "./edition";
import {
  RUNNERS_PER_TEAM,
  buildBusinessRaceTeams,
  getBusinessRaceTeamCount,
  getBusinessRaceTeamStatus,
  normalizeBusinessRaceTeam,
} from "./business-race-helpers";
import { getBusinessRaceCopy } from "./business-race-copy";
import "./business-race.css";

// Bloc d'accueil (en-tête du portail) : bienvenue et format de la course.
function BusinessRaceWelcome({ language, portal }) {
  const c = getBusinessRaceCopy(language);
  const teamCount = getBusinessRaceTeamCount(portal);
  return (
    <div className="br-welcome">
      <p><strong>{c.welcomeTitle}</strong> {c.welcomeBody}</p>
      <ul className="br-format">
        {c.format.map((item) => <li key={item}>{item}</li>)}
        <li className="is-strong">{c.teamsCount.replace("{n}", teamCount)}</li>
      </ul>
    </div>
  );
}

// Les 3 étapes, sur toute la largeur sous l'en-tête ; `offer` : types de places.
function BusinessRaceSteps({ language, offer }) {
  const c = getBusinessRaceCopy(language);
  return (
    <section className="vip-portal-card br-steps-card">
      <ol className="br-steps">
        <li><strong>{c.stepTeamsTitle}</strong>{c.stepTeamsBody}</li>
        <li><strong>{c.stepGuestsTitle}</strong>{c.stepGuestsBody}</li>
        <li><strong>{c.stepDayTitle}</strong>{c.stepDayBody}</li>
      </ol>
      {offer}
    </section>
  );
}

function GenderToggle({ value, onChange, c }) {
  return (
    <div className="br-gender-toggle" role="radiogroup" aria-label={c.gender}>
      {[["F", c.woman], ["M", c.man]].map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          className={`is-${key}${value === key ? " is-on" : ""}`}
          onClick={() => onChange(value === key ? "" : key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RunnerRow({ label, leg, runner, onChange, c, reserve = false }) {
  const change = (field) => (event) => onChange({ ...runner, [field]: event.target.value });
  return (
    <div className={`br-runner-row${reserve ? " br-runner-row--reserve" : ""}`}>
      <span className="br-runner-row__label">
        <span className="br-leg">{reserve ? "R" : leg}</span>
        {label}
      </span>
      <input aria-label={`${label} · ${c.firstName}`} placeholder={c.firstName} autoComplete="off" value={runner.firstName} onChange={change("firstName")} />
      <input aria-label={`${label} · ${c.lastName}`} placeholder={c.lastName} autoComplete="off" value={runner.lastName} onChange={change("lastName")} />
      <GenderToggle value={runner.gender} c={c} onChange={(gender) => onChange({ ...runner, gender })} />
    </div>
  );
}

function sameTeam(left, right) {
  return JSON.stringify(normalizeBusinessRaceTeam(left)) === JSON.stringify(normalizeBusinessRaceTeam(right));
}

function TeamForm({ team, teamCount, organization, c, onSave }) {
  const [draft, setDraft] = useState(team);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const dirty = !sameTeam(draft, team);

  // Mise à jour venue d'ailleurs (autre onglet, équipe du meeting) : on la reprend
  // tant qu'il n'y a pas de saisie en cours.
  useEffect(() => {
    if (!dirty) setDraft(team);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team]);

  const status = getBusinessRaceTeamStatus(draft);
  const statusLabel = status.complete
    ? c.statusComplete
    : status.state === "empty"
      ? c.statusEmpty
      : c.statusPartial.replace("{n}", status.filled);
  const hint =
    status.missingGender > 0
      ? c.missingGender
      : status.filled === RUNNERS_PER_TEAM && !status.genderOk
        ? c.genderHint.replace("{w}", status.women).replace("{m}", status.men)
        : "";

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFeedback("");
    const ok = await onSave(normalizeBusinessRaceTeam(draft, team.teamNumber));
    setSaving(false);
    setFeedback(ok ? c.saved : c.saveError);
  }

  return (
    <form className={`br-team-form${status.complete ? " is-complete" : ""}`} onSubmit={handleSubmit}>
      <div className="br-team-form__head">
        <label className="br-field">
          <span>{teamCount > 1 ? `${c.team.replace("{n}", team.teamNumber)} · ${c.teamName}` : c.teamName}</span>
          <input
            value={draft.teamName}
            placeholder={teamCount > 1 ? `${organization} ${team.teamNumber}` : organization}
            onChange={(event) => setDraft((current) => ({ ...current, teamName: event.target.value }))}
          />
        </label>
        <span className={`br-chip br-team-form__status br-chip--${status.complete ? "ok" : status.state === "empty" ? "empty" : "warn"}`}>{statusLabel}</span>
      </div>
      <div className="br-runners-head" aria-hidden="true">
        <span />
        <span>{c.firstName}</span>
        <span>{c.lastName}</span>
        <span>{c.gender}</span>
      </div>
      {draft.runners.map((runner, index) => (
        <RunnerRow
          key={index}
          leg={index + 1}
          label={c.legShort.replace("{n}", index + 1)}
          runner={runner}
          c={c}
          onChange={(next) =>
            setDraft((current) => ({ ...current, runners: current.runners.map((item, itemIndex) => (itemIndex === index ? next : item)) }))
          }
        />
      ))}
      <RunnerRow reserve label={c.reserve} runner={draft.reserve} c={c} onChange={(next) => setDraft((current) => ({ ...current, reserve: next }))} />
      <div className="br-team-form__bar">
        {hint ? <p className="br-hint">{hint}</p> : feedback && !dirty ? <p className={feedback === c.saved ? "br-saved" : "br-hint"}>{feedback}</p> : dirty ? <p className="br-hint">{c.unsaved}</p> : null}
        <button type="submit" className="br-btn br-btn--primary" disabled={saving || !dirty}>{saving ? c.saving : c.save}</button>
      </div>
    </form>
  );
}

// Équipes de l'entreprise : une fiche par équipe (teams/team-{n}), enregistrée
// équipe par équipe. En démo (npm run dev), rien n'est écrit.
function BusinessRaceTeamsSection({ language, portalId, portal, organization, isDemo = false }) {
  const c = getBusinessRaceCopy(language);
  const [storedTeams, setStoredTeams] = useState(isDemo ? DEMO_TEAMS : []);
  const [loading, setLoading] = useState(!isDemo);

  useEffect(() => {
    if (isDemo || !portalId) return undefined;
    return onSnapshot(
      collection(db, "vipPartnerPortals", portalId, "teams"),
      (snapshot) => {
        setStoredTeams(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        setLoading(false);
      },
      (snapshotError) => {
        console.error("Business Race teams load failed", snapshotError);
        setLoading(false);
      },
    );
  }, [portalId, isDemo]);

  const teams = buildBusinessRaceTeams(portal, storedTeams);

  async function saveTeam(team) {
    if (isDemo) {
      setStoredTeams((current) => [...current.filter((item) => item.teamNumber !== team.teamNumber), team]);
      return true;
    }
    try {
      const editionId = await getActiveEditionId();
      await setDoc(doc(db, "vipPartnerPortals", portalId, "teams", `team-${team.teamNumber}`), {
        ...team,
        portalId,
        organization,
        editionId: editionId || "",
        updatedAt: serverTimestamp(),
      });
      return true;
    } catch (saveError) {
      console.error("Business Race team save failed", saveError);
      return false;
    }
  }

  return (
    <section className="vip-portal-card br-portal">
      <div className="vip-portal-card__head">
        <h3>{c.teamsTitle} <span className="vip-portal-count">{teams.length}</span></h3>
      </div>
      <p className="vip-portal-muted">{c.teamsIntro}</p>
      {loading ? (
        <p className="vip-portal-muted">{c.loading}</p>
      ) : (
        <div className="br-portal__teams">
          {teams.map((team) => (
            <TeamForm key={team.id} team={team} teamCount={teams.length} organization={organization} c={c} onSave={saveTeam} />
          ))}
        </div>
      )}
    </section>
  );
}

const DEMO_TEAMS = [
  {
    teamNumber: 1,
    teamName: "Les Fusées",
    runners: [
      { firstName: "Julie", lastName: "Martin", gender: "F" },
      { firstName: "Paul", lastName: "Schmit", gender: "M" },
      { firstName: "", lastName: "", gender: "" },
      { firstName: "", lastName: "", gender: "" },
    ],
    reserve: { firstName: "", lastName: "", gender: "" },
  },
];

export { BusinessRaceSteps, BusinessRaceTeamsSection, BusinessRaceWelcome };
