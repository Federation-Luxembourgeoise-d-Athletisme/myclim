import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { getActiveEditionId } from "./edition";
import {
  RUNNERS_PER_TEAM,
  RUNNER_VIP_SOURCE,
  areBusinessRaceTeamsLocked,
  buildBusinessRaceTeams,
  buildRunnerVipEntryId,
  countTeamVipRunners,
  getBusinessRaceTeamLabel,
  getTeamTrainings,
  listTeamSlots,
  runnerIsFilled,
  getBusinessRaceTeamCount,
  getBusinessRaceTeamStatus,
  normalizeBusinessRaceTeam,
} from "./business-race-helpers";
import { getBusinessRaceCopy } from "./business-race-copy";
import { useBusinessRaceSettings } from "./business-race-settings";
import { buildVipRegistrationPayload, getVipEntryPlaceType, getVipPortalCaps } from "./vip-helpers";

function formatPortalDate(isoDate, language) {
  if (!isoDate) return "";
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  const locale = language === "fr" ? "fr-LU" : language === "de" ? "de-LU" : "en-GB";
  return date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatPortalTime(time, language) {
  if (!time) return "";
  return language === "fr" ? time.replace(":", "h") : time;
}

function formatTraining(training, c, language) {
  const date = formatPortalDate(training.date, language);
  return training.time ? c.trainingAt.replace("{date}", date).replace("{time}", formatPortalTime(training.time, language)) : date;
}
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

// Titre cliquable d'une case repliable (▾ ouverte, ▸ repliée) ; `summary` : ligne
// affichée quand elle est repliée.
function BoxToggle({ open, onToggle, label, title, summary, children }) {
  return (
    <div className="br-box-head">
      <button type="button" className="br-box-toggle" aria-expanded={open} title={label} onClick={onToggle}>
        <span className="br-box-toggle__caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <h3>{title}</h3>
      </button>
      {!open && summary ? <span className="br-box-summary">{summary}</span> : null}
      {children}
    </div>
  );
}

// Les 3 étapes, sur toute la largeur sous l'en-tête ; `offer` : types de places.
function BusinessRaceSteps({ language, offer, portal, collapsed = false, onToggle }) {
  const c = getBusinessRaceCopy(language);
  const { settings } = useBusinessRaceSettings();
  const deadline = formatPortalDate(settings.teamsDeadline, language);
  // Entraînements des équipes de l'entreprise ; nom de l'équipe quand une
  // entreprise a plusieurs équipes à des créneaux différents.
  const teamCount = getBusinessRaceTeamCount(portal);
  const byTraining = new Map();
  for (let teamNumber = 1; teamNumber <= teamCount; teamNumber += 1) {
    getTeamTrainings(settings, portal?.id || "", teamNumber).forEach((training) => {
      const entry = byTraining.get(training.id) || { training, teams: [] };
      entry.teams.push(teamNumber);
      byTraining.set(training.id, entry);
    });
  }
  const trainings = [...byTraining.values()].sort((left, right) =>
    `${left.training.date}${left.training.time}`.localeCompare(`${right.training.date}${right.training.time}`),
  );
  return (
    <section className={`vip-portal-card br-steps-card${collapsed ? " is-collapsed" : ""}`}>
      <BoxToggle
        open={!collapsed}
        onToggle={onToggle}
        label={c.toggleBox}
        title={c.keyDatesSteps}
        summary={deadline ? `${c.deadlineLabel} ${c.deadlineValue.replace("{date}", deadline)}` : ""}
      />
      <div className="br-box-body" hidden={collapsed}>
      {deadline || trainings.length ? (
        <dl className="br-keydates" aria-label={c.keyDates}>
          {deadline ? (
            <div>
              <dt>{c.deadlineLabel}</dt>
              <dd>{c.deadlineValue.replace("{date}", deadline)}</dd>
            </div>
          ) : null}
          {trainings.map(({ training, teams }) => (
            <div key={training.id}>
              <dt>{c.trainingLabel}</dt>
              <dd>
                {formatTraining(training, c, language)}
                {training.place ? <span>{training.place}</span> : null}
                {training.note ? <small>{training.note}</small> : null}
                {teamCount > 1 && teams.length < teamCount ? (
                  <span className="br-keydates__team">
                    {teams.map((teamNumber) => c.team.replace("{n}", teamNumber)).join(", ")}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ol className="br-steps">
        <li><strong>{c.stepTeamsTitle}</strong>{c.stepTeamsBody}</li>
        <li><strong>{c.stepGuestsTitle}</strong>{c.stepGuestsBody}</li>
        <li><strong>{c.stepDayTitle}</strong>{c.stepDayBody}</li>
      </ol>
      {offer}
      </div>
    </section>
  );
}

function GenderToggle({ value, onChange, c, disabled = false }) {
  return (
    <div className="br-gender-toggle" role="radiogroup" aria-label={c.gender}>
      {[["F", c.woman], ["M", c.man]].map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          className={`is-${key}${value === key ? " is-on" : ""}`}
          disabled={disabled}
          onClick={() => onChange(value === key ? "" : key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RunnerRow({ label, leg, runner, onChange, c, reserve = false, vipEnabled = false, vipBlocked = false, disabled = false }) {
  const change = (field) => (event) => onChange({ ...runner, [field]: event.target.value });
  return (
    <div className={`br-runner-row${reserve ? " br-runner-row--reserve" : ""}${vipEnabled ? " has-vip" : ""}`}>
      <span className="br-runner-row__label">
        <span className="br-leg">{reserve ? "R" : leg}</span>
        {label}
      </span>
      <input aria-label={`${label} · ${c.firstName}`} placeholder={c.firstName} autoComplete="off" disabled={disabled} value={runner.firstName} onChange={change("firstName")} />
      <input aria-label={`${label} · ${c.lastName}`} placeholder={c.lastName} autoComplete="off" disabled={disabled} value={runner.lastName} onChange={change("lastName")} />
      <GenderToggle value={runner.gender} c={c} disabled={disabled} onChange={(gender) => onChange({ ...runner, gender })} />
      {vipEnabled ? (
        <label className={`br-vip-toggle${runner.vip ? " is-on" : ""}`} title={c.vipToggle}>
          <input
            type="checkbox"
            aria-label={`${label} · ${c.vipToggle}`}
            checked={Boolean(runner.vip)}
            disabled={disabled || (!runner.vip && vipBlocked)}
            onChange={(event) => onChange({ ...runner, vip: event.target.checked })}
          />
          {c.vip}
        </label>
      ) : null}
    </div>
  );
}

function sameTeam(left, right) {
  return JSON.stringify(normalizeBusinessRaceTeam(left)) === JSON.stringify(normalizeBusinessRaceTeam(right));
}

function TeamForm({ team, teamCount, organization, c, onSave, locked = false, vip, trainings = [], language }) {
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

  // Places VIP : celles déjà prises hors de cette équipe + les coureurs cochés ici.
  const vipUsedOutside = vip.usedOutside(team.teamNumber);
  const vipUsed = vipUsedOutside + countTeamVipRunners(draft);
  const vipOver = vip.cap !== null && vipUsed > vip.cap;
  const vipBlocked = vip.cap !== null && vipUsed >= vip.cap;
  const vipQuotaText = vip.cap === null ? "" : c.vipQuota.replace("{cap}", vip.cap).replace("{used}", vipUsedOutside);

  async function handleSubmit(event) {
    event.preventDefault();
    if (locked) return;
    if (vipOver) {
      setFeedback(vipQuotaText);
      return;
    }
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
            disabled={locked}
            placeholder={teamCount > 1 ? `${organization} ${team.teamNumber}` : organization}
            onChange={(event) => setDraft((current) => ({ ...current, teamName: event.target.value }))}
          />
        </label>
        {trainings.length ? (
          <p className="br-team-form__trainings">
            {c.trainingLabel} : <strong>{trainings.map((training) => formatTraining(training, c, language)).join(" · ")}</strong>
          </p>
        ) : null}
        <span className={`br-chip br-team-form__status br-chip--${status.complete ? "ok" : status.state === "empty" ? "empty" : "warn"}`}>{statusLabel}</span>
      </div>
      <div className={`br-runners-head${vip.enabled ? " has-vip" : ""}`} aria-hidden="true">
        <span />
        <span>{c.firstName}</span>
        <span>{c.lastName}</span>
        <span>{c.gender}</span>
        {vip.enabled ? <span>{c.vip}</span> : null}
      </div>
      {draft.runners.map((runner, index) => (
        <RunnerRow
          key={index}
          leg={index + 1}
          label={c.legShort.replace("{n}", index + 1)}
          runner={runner}
          c={c}
          disabled={locked}
          vipEnabled={vip.enabled}
          vipBlocked={vipBlocked}
          onChange={(next) =>
            setDraft((current) => ({ ...current, runners: current.runners.map((item, itemIndex) => (itemIndex === index ? next : item)) }))
          }
        />
      ))}
      <RunnerRow reserve label={c.reserve} runner={draft.reserve} c={c} disabled={locked} vipEnabled={vip.enabled} vipBlocked={vipBlocked} onChange={(next) => setDraft((current) => ({ ...current, reserve: next }))} />
      {locked ? null : (
      <div className="br-team-form__bar">
        {vipOver ? <p className="br-hint">{vipQuotaText}</p> : hint ? <p className="br-hint">{hint}</p> : feedback && !dirty ? <p className={feedback === c.saved ? "br-saved" : "br-hint"}>{feedback}</p> : dirty ? <p className="br-hint">{c.unsaved}</p> : null}
        <button type="submit" className="br-btn br-btn--primary" disabled={saving || !dirty || vipOver}>{saving ? c.saving : c.save}</button>
      </div>
      )}
    </form>
  );
}

// Équipes de l'entreprise : une fiche par équipe (teams/team-{n}), enregistrée
// équipe par équipe. En démo (npm run dev), rien n'est écrit.
function BusinessRaceTeamsSection({ language, portalId, portal, organization, entries = [], isStaff = false, onDemoEntries, isDemo = false, collapsed = false, onToggle }) {
  const c = getBusinessRaceCopy(language);
  const { settings } = useBusinessRaceSettings();
  const deadlinePassed = areBusinessRaceTeamsLocked(settings);
  // Après la date limite : figé pour l'entreprise ; l'organisation peut encore corriger.
  const locked = deadlinePassed && !isStaff;
  // Places cumulées (partenariat VIP + pack Business Race).
  const vipCap = getVipPortalCaps(portal || {}).total.vip;
  const vipEntries = entries.filter((entry) => getVipEntryPlaceType(entry) === "vip");
  const vip = {
    enabled: vipCap === null || vipCap > 0,
    cap: vipCap,
    usedOutside: (teamNumber) => vipEntries.filter((entry) => !String(entry.id).startsWith(`br-runner-${teamNumber}-`)).length,
  };
  const vipLeft = vipCap === null ? null : Math.max(0, vipCap - vipEntries.length);
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
    const slots = listTeamSlots(team);
    const legLabel = (slot) => (slot === "reserve" ? "remplaçant" : `relayeur ${slot.replace("leg", "")}`);
    const teamLabel = getBusinessRaceTeamLabel(team, organization, getBusinessRaceTeamCount(portal));
    const vipPayload = (slot, runner, extra) =>
      buildVipRegistrationPayload(
        { firstName: runner.firstName, lastName: runner.lastName, organization, vipTourChoice: "none", notes: `Coureur Business Race · ${teamLabel} · ${legLabel(slot)}` },
        { placeType: "vip", source: RUNNER_VIP_SOURCE, teamNumber: team.teamNumber, slot, ...extra },
      );
    if (isDemo) {
      setStoredTeams((current) => [...current.filter((item) => item.teamNumber !== team.teamNumber), team]);
      onDemoEntries?.(
        team.teamNumber,
        slots.filter(({ runner }) => runner.vip && runnerIsFilled(runner)).map(({ slot, runner }) => ({ id: buildRunnerVipEntryId(team.teamNumber, slot), ...vipPayload(slot, runner, {}) })),
      );
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
      // Coureurs avec une place VIP : une fiche invité VIP chacun (liste VIP,
      // badge VIP, caisse) ; décochés ou effacés : leur fiche est retirée.
      const existingIds = new Set(entries.map((entry) => entry.id));
      await Promise.all(
        slots.map(({ slot, runner }) => {
          const entryId = buildRunnerVipEntryId(team.teamNumber, slot);
          const entryRef = doc(db, "vipPartnerPortals", portalId, "entries", entryId);
          if (runner.vip && runnerIsFilled(runner)) {
            const stamp = existingIds.has(entryId) ? { updatedAt: serverTimestamp() } : { createdAt: serverTimestamp() };
            return setDoc(entryRef, vipPayload(slot, runner, { editionId: editionId || "", portalId, ...stamp }), { merge: true });
          }
          return existingIds.has(entryId) ? deleteDoc(entryRef) : null;
        }),
      );
      return true;
    } catch (saveError) {
      console.error("Business Race team save failed", saveError);
      return false;
    }
  }

  return (
    <section className={`vip-portal-card br-portal${collapsed ? " is-collapsed" : ""}`}>
      <BoxToggle
        open={!collapsed}
        onToggle={onToggle}
        label={c.toggleBox}
        title={<>{c.teamsTitle} <span className="vip-portal-count">{teams.length}</span></>}
        summary={c.teamsSummary.replace("{c}", teams.filter((team) => getBusinessRaceTeamStatus(team).complete).length).replace("{n}", teams.length)}
      />
      {/* Masqué (pas retiré) : une saisie en cours n'est pas perdue en repliant. */}
      <div className="br-box-body" hidden={collapsed}>
      <p className="vip-portal-muted">{c.teamsIntro}</p>
      {vip.enabled && !locked ? (
        <p className="br-vip-hint">{c.vipHint.replace("{left}", vipLeft === null ? "" : c.vipLeft.replace("{n}", vipLeft))}</p>
      ) : null}
      {deadlinePassed ? (
        <p className={`br-locked${isStaff ? " is-staff" : ""}`}>
          {isStaff ? c.lockedStaff : c.lockedNotice.replace("{date}", formatPortalDate(settings.teamsDeadline, language))}
        </p>
      ) : null}
      {loading ? (
        <p className="vip-portal-muted">{c.loading}</p>
      ) : (
        <div className="br-portal__teams">
          {teams.map((team) => (
            <TeamForm
              key={team.id}
              team={team}
              teamCount={teams.length}
              organization={organization}
              c={c}
              language={language}
              onSave={saveTeam}
              locked={locked}
              vip={vip}
              trainings={getTeamTrainings(settings, portalId, team.teamNumber)}
            />
          ))}
        </div>
      )}
      </div>
    </section>
  );
}

const DEMO_TEAMS = [
  {
    teamNumber: 1,
    teamName: "Les Fusées",
    runners: [
      { firstName: "Julie", lastName: "Martin", gender: "F", vip: true },
      { firstName: "Paul", lastName: "Schmit", gender: "M" },
      { firstName: "", lastName: "", gender: "" },
      { firstName: "", lastName: "", gender: "" },
    ],
    reserve: { firstName: "", lastName: "", gender: "" },
  },
];

export { BoxToggle, BusinessRaceSteps, BusinessRaceTeamsSection, BusinessRaceWelcome };
